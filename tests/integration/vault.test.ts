import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import {
  setCredential,
  listCredentials,
  resolveCredentials,
  deleteCredential,
  primaryHost,
} from "../../lib/vault";
import type { SkillStep } from "../../lib/types";

const OWNER = "VAULT_O";

beforeAll(async () => {
  await ready();
});

describe("credential vault", () => {
  it("stores, resolves (decrypted), upserts, and never leaks values in the list", async () => {
    await setCredential(OWNER, "Example.com", "password", "hunter2");
    await setCredential(OWNER, "example.com", "username", "ann");

    const resolved = await resolveCredentials(OWNER, "example.com"); // host lowercased
    expect(resolved).toEqual({ password: "hunter2", username: "ann" });

    // upsert (same host+key) replaces, doesn't duplicate
    await setCredential(OWNER, "example.com", "password", "newpass");
    expect((await resolveCredentials(OWNER, "example.com")).password).toBe("newpass");

    const meta = await listCredentials(OWNER);
    expect(meta).toHaveLength(2);
    expect(JSON.stringify(meta)).not.toContain("newpass"); // metadata only
  });

  it("scopes by owner + host and deletes", async () => {
    await setCredential(OWNER, "other.com", "token", "t");
    expect(await resolveCredentials("SOMEONE_ELSE", "example.com")).toEqual({});
    const meta = await listCredentials(OWNER);
    const entry = meta.find((m) => m.host === "other.com")!;
    expect(await deleteCredential(entry.id, "WRONG")).toBe(false);
    expect(await deleteCredential(entry.id, OWNER)).toBe(true);
    expect(await resolveCredentials(OWNER, "other.com")).toEqual({});
  });

  it("primaryHost prefers the allowlist, then the first navigate target", () => {
    const nav: SkillStep = {
      idx: 0, intent: "", action: "navigate", selectors: [], target: "https://app.site.com/x",
      valueSource: "none", value: "", inputKey: "", key: "",
    };
    expect(primaryHost(["a.com"], [nav])).toBe("a.com");
    expect(primaryHost([], [nav])).toBe("app.site.com");
    expect(primaryHost([], [])).toBe("");
  });
});
