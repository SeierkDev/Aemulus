import { beforeAll, describe, expect, it, vi } from "vitest";
import { ready } from "../../lib/db";
import { createApiKey } from "../../lib/api-keys";
import { createSkill } from "../../lib/skills";
import { GET as listWatches, POST as createWatch } from "../../app/api/v1/watches/route";
import {
  GET as getWatchRoute,
  PATCH as patchWatch,
  DELETE as deleteWatch,
} from "../../app/api/v1/watches/[id]/route";
import type { GeneralizedSkill, Skill } from "../../lib/types";

vi.mock("../../lib/runner", () => ({ executeRun: vi.fn() }));

/**
 * Pinned to Holder, deliberately.
 *
 * With no mint configured — which is the test environment — computeTier returns
 * Open/level 3 and the whale allowance is unlimited, so EVERY cadence is
 * affordable and the tier gate can never be observed. Testing it needs a wallet
 * that actually has a ceiling, so this is the entry tier: 48 checks a day, which
 * covers every30m and refuses every15m and every10m.
 */
vi.mock("../../lib/solana", async () => {
  const actual = await vi.importActual<typeof import("../../lib/solana")>("../../lib/solana");
  return {
    ...actual,
    getAemulusBalance: async () => 1,
    computeTier: () => ({ name: "Holder", level: 1, allowed: true }),
    watchLimitForLevel: (level: number) => (level === 1 ? 48 : actual.watchLimitForLevel(level)),
  };
});

/**
 * The endpoints, actually run.
 *
 * The SDK's own tests drive a stub, which proves the client sends the shape it
 * intends and nothing about whether the server accepts it. That gap is not
 * theoretical here: the first verifyDisclosure() posted a body the endpoint
 * could never parse, and a stub written to match the same mistake would have
 * agreed with it.
 *
 * So these call the route handlers directly with a real API key against the
 * in-memory database — real auth, real scope checks, real tier gate, real
 * ownership scoping.
 */

const OWNER = "w_v1_watch";
const STRANGER = "w_v1_other";
let skill: Skill;
let key = "";
let strangerKey = "";

const req = (url: string, k: string, init: RequestInit = {}) =>
  new Request(url, {
    ...init,
    headers: { authorization: `Bearer ${k}`, "content-type": "application/json" },
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("v1 watches", () => {
  beforeAll(async () => {
    await ready();
    skill = await createSkill({
      owner: OWNER,
      generalized: {
        name: "Watchable",
        description: "",
        inputFields: [],
        steps: [],
      } as unknown as GeneralizedSkill,
      sourceDemoId: null,
    });
    key = (await createApiKey(OWNER, "test", ["read", "run"])).key;
    strangerKey = (await createApiKey(STRANGER, "test", ["read", "run"])).key;
  });

  it("refuses a request with no key", async () => {
    const res = await listWatches(new Request("https://x/api/v1/watches"));
    expect(res.status).toBe(401);
  });

  it("refuses a key without the run scope", async () => {
    const readOnly = (await createApiKey(OWNER, "ro", ["read"])).key;
    const res = await createWatch(
      req("https://x/api/v1/watches", readOnly, {
        method: "POST",
        body: JSON.stringify({
          skillId: skill.id,
          cadence: "daily",
          rule: { key: "status", op: "changed" },
        }),
      }),
    );
    expect(res.status).toBe(403);
  });

  let watchId = "";

  it("creates the schedule and the rule together", async () => {
    const res = await createWatch(
      req("https://x/api/v1/watches", key, {
        method: "POST",
        body: JSON.stringify({
          skillId: skill.id,
          cadence: "daily",
          rule: { key: "status", op: "changed" },
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    watchId = body.id;
    expect(watchId).toBeTruthy();

    // The rule has to actually be attached — a schedule without one burns the
    // watch allowance every cadence and reports nothing.
    const one = await getWatchRoute(req(`https://x/api/v1/watches/${watchId}`, key), params(watchId));
    expect(one.status).toBe(200);
    expect((await one.json()).rule).toMatchObject({ key: "status", op: "changed" });
  });

  it("lists it back with its current value", async () => {
    const res = await listWatches(req("https://x/api/v1/watches", key));
    expect(res.status).toBe(200);
    const { watches } = await res.json();
    expect(watches.map((w: { id: string }) => w.id)).toContain(watchId);
    expect(watches[0]).toHaveProperty("lastValue");
    expect(watches[0]).toHaveProperty("cadence");
  });

  it("refuses a cadence the tier cannot sustain, before creating anything", async () => {
    const before = (await (await listWatches(req("https://x/api/v1/watches", key))).json()).watches.length;
    const res = await createWatch(
      req("https://x/api/v1/watches", key, {
        method: "POST",
        body: JSON.stringify({
          skillId: skill.id,
          cadence: "every10m", // 144 checks a day against an allowance of 48
          rule: { key: "status", op: "changed" },
        }),
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    // Told what they CAN have, not just refused.
    expect(body.affordable).toContain("every30m");
    expect(body.affordable).not.toContain("every10m");

    const after = (await (await listWatches(req("https://x/api/v1/watches", key))).json()).watches.length;
    expect(after).toBe(before); // nothing half-created
  });

  it("rejects a rule the schema does not allow", async () => {
    const res = await createWatch(
      req("https://x/api/v1/watches", key, {
        method: "POST",
        body: JSON.stringify({
          skillId: skill.id,
          cadence: "daily",
          rule: { key: "status", op: "explodes" },
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  // The check that matters most: an id is not a capability.
  it("hides another wallet's watch behind not-found", async () => {
    const get = await getWatchRoute(
      req(`https://x/api/v1/watches/${watchId}`, strangerKey),
      params(watchId),
    );
    expect(get.status).toBe(404);

    const patch = await patchWatch(
      req(`https://x/api/v1/watches/${watchId}`, strangerKey, {
        method: "PATCH",
        body: JSON.stringify({ active: false }),
      }),
      params(watchId),
    );
    expect(patch.status).toBe(404);

    const del = await deleteWatch(
      req(`https://x/api/v1/watches/${watchId}`, strangerKey, { method: "DELETE" }),
      params(watchId),
    );
    expect(del.status).toBe(404);

    // And it is still there for its owner.
    const mine = await getWatchRoute(req(`https://x/api/v1/watches/${watchId}`, key), params(watchId));
    expect(mine.status).toBe(200);
  });

  it("pauses, resumes and deletes", async () => {
    const off = await patchWatch(
      req(`https://x/api/v1/watches/${watchId}`, key, {
        method: "PATCH",
        body: JSON.stringify({ active: false }),
      }),
      params(watchId),
    );
    expect((await off.json()).active).toBe(false);

    const on = await patchWatch(
      req(`https://x/api/v1/watches/${watchId}`, key, {
        method: "PATCH",
        body: JSON.stringify({ active: true }),
      }),
      params(watchId),
    );
    expect((await on.json()).active).toBe(true);

    const del = await deleteWatch(
      req(`https://x/api/v1/watches/${watchId}`, key, { method: "DELETE" }),
      params(watchId),
    );
    expect(del.status).toBe(200);

    const gone = await getWatchRoute(req(`https://x/api/v1/watches/${watchId}`, key), params(watchId));
    expect(gone.status).toBe(404);
  });

  it("404s a skill that is not yours and not published", async () => {
    const res = await createWatch(
      req("https://x/api/v1/watches", strangerKey, {
        method: "POST",
        body: JSON.stringify({
          skillId: skill.id,
          cadence: "daily",
          rule: { key: "status", op: "changed" },
        }),
      }),
    );
    expect(res.status).toBe(404);
  });
});
