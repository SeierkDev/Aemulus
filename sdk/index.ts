/**
 * Aemulus SDK - a tiny, dependency-free TypeScript client for the public
 * Aemulus protocol (/api/v1). Published to npm as `aemulus`.
 * Works anywhere `fetch` exists (Node 18+, browsers, Deno, edge).
 *
 *   import { Aemulus } from "aemulus";
 *   const aemulus = new Aemulus({ apiKey: process.env.AEMULUS_KEY! });
 *   const run = await aemulus.runAndWait("skl_…", { vendor: "Acme" });
 *   console.log(run.output);        // { total: "$42.00" }
 *   await aemulus.verify(run.id);    // anyone can - no key needed
 */

export interface AemulusOptions {
  apiKey: string;
  /** Defaults to the hosted protocol; override for self-hosting/tests. */
  baseUrl?: string;
}

export type RunStatus =
  | "running"
  | "awaiting_input"
  | "completed"
  | "needs_review"
  | "failed";

export interface Run {
  id: string;
  skillId?: string;
  status: RunStatus;
  result?: string | null;
  output?: Record<string, string> | null;
  receiptHash?: string | null;
  steps?: number;
  createdAt?: number;
  /** Which version of the skill actually executed. A success rate that moves
   *  usually moves because of an edit, and this is what ties the two together. */
  skillVersion?: number | null;
  /** Whether a model confirmed, from the final screen, that the goal was met.
   *  "completed" means the steps ran; this means the point of them was achieved. */
  outcomeStatus?: "achieved" | "unconfirmed" | null;
  outcomeReason?: string | null;
  /** Canonical JSON of the isolation policy this run executed under. */
  sandbox?: string | null;
  /** AgenC canonical constraint hash for this run's output vector. */
  agencHash?: string | null;
  /** Root of the run's hiding commitment — what a disclosure proves against. */
  commitmentRoot?: string | null;
  /** Steps the agent finished after the recorded selector failed. Above zero
   *  means the run reached its goal without following the plan exactly. */
  repairedSteps?: number;
}

export type Cadence =
  | "every10m" | "every15m" | "every30m" | "hourly"
  | "every6h" | "every12h" | "daily" | "weekdays" | "weekly";

/** What counts as a change worth telling you about. */
export interface WatchRule {
  /** Which of the skill's output keys to watch. */
  key: string;
  op: "changed" | "equals" | "contains" | "not_contains" | "appears" | "disappears" | "above" | "below";
  /** Operand for equals / contains / not_contains / above / below. */
  value?: string;
  /** Consecutive checks that must agree before alerting. 2+ absorbs a value
   *  that flickers — an A/B test, a number mid-recalculation. */
  confirm?: number;
  /** Minimum gap between alerts, in ms. */
  cooldownMs?: number;
}

export interface Watch {
  id: string;
  skillId?: string;
  skillName?: string;
  cadence?: Cadence;
  active?: boolean;
  rule: WatchRule;
  /** What the page said at the last successful check. */
  lastValue?: string | null;
  /** Consecutive failed checks. A watch reports itself broken at three. */
  failStreak?: number;
  mutedUntil?: number | null;
  lastRunAt?: number | null;
  nextRunAt?: number;
}

/** A proof that one field of a run had a particular value, and nothing else. */
export interface Disclosure {
  runId: string;
  field: string;
  value: string;
  salt: string;
  root: string;
  proof: { siblings: { hash: string; left: boolean }[] };
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  version: number;
  runCount: number;
  inputs: { key: string; label: string }[];
}

export interface Verification {
  found: boolean;
  runId?: string;
  status?: RunStatus;
  steps?: number;
  hash?: string | null;
  matches?: boolean;
  batch?: {
    id?: string;
    root: string;
    index: number;
    leafCount: number;
    proofValid: boolean;
    anchor?: {
      sig: string;
      cluster: string;
      url: string;
      memoMatches: boolean | null; // null = chain unreachable (unknown), not "no match"
    } | null;
  };
  /** The isolation policy the run executed under, as canonical JSON. Part of
   *  what the receipt attests, so it cannot be edited after the fact. */
  sandbox?: string | null;
  /** Commitment root for selective disclosure. Reveals nothing by itself. */
  commitmentRoot?: string | null;
  /** Steps the agent performed after the recorded selector failed. Inside the
   *  receipt: it can be neither scrubbed from a run nor forged onto one. */
  repairedSteps?: number;
  /** Steps whose screenshot the receipt commits to but that is no longer
   *  stored. A mismatch caused by this is missing evidence, NOT altered
   *  evidence — the difference between "cannot check" and "was changed". */
  missingShots?: number;
  /** On-chain registry record, when the run was anchored individually. */
  registry?: { sig: string; cluster: string; url: string };
  /** AgenC interop: a public commitment to a private result. */
  agenc?: { constraintHash: string; commitment: string | null; arity: number };
  /** Screenshots the owner chose to publish permanently, on Arweave. */
  shots?: { hash: string; url: string }[];
}

export class AemulusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AemulusError";
  }
}

const TERMINAL: RunStatus[] = ["completed", "needs_review", "failed"];

/** Build a `?limit&cursor` query string (empty when no opts given). */
function query(opts: { limit?: number; cursor?: string }): string {
  const qs = new URLSearchParams();
  if (opts.limit != null) qs.set("limit", String(opts.limit));
  if (opts.cursor) qs.set("cursor", opts.cursor);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export class Aemulus {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: AemulusOptions) {
    if (!opts?.apiKey) throw new Error("Aemulus: apiKey is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://aemulusai.com").replace(/\/$/, "");
  }

  private async call<T>(
    path: string,
    init: RequestInit = {},
    auth = true,
    timeoutMs = 30_000,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(init.headers as Record<string, string>),
    };
    if (auth) headers.authorization = `Bearer ${this.apiKey}`;
    let res: Response;
    try {
      // Bound every request so a hung connection can't block forever.
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") {
        throw new AemulusError(`Request timed out: ${path}`, 408);
      }
      throw new AemulusError(
        e instanceof Error ? e.message : `Request failed: ${path}`,
        0,
      );
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new AemulusError(body?.error || `Request failed (${res.status})`, res.status);
    }
    return body as T;
  }

  /** Start a run; returns immediately with status "running".
   *  Pass `idempotencyKey` so a retry returns the same run instead of a new one. */
  run(
    skillId: string,
    input: Record<string, string> = {},
    opts: { idempotencyKey?: string } = {},
  ): Promise<Run> {
    return this.call<Run>("/api/v1/runs", {
      method: "POST",
      headers: opts.idempotencyKey
        ? { "idempotency-key": opts.idempotencyKey }
        : undefined,
      body: JSON.stringify({ skillId, input }),
    });
  }

  /** Fetch a run's current state (status, result, extracted output, receipt). */
  getRun(id: string): Promise<Run> {
    return this.call<Run>(`/api/v1/runs/${id}`);
  }

  /** One page of the published skill catalog. Pass `cursor` (from a prior
   *  `nextCursor`) to page; `nextCursor` is null on the last page. */
  listSkills(
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{ skills: SkillSummary[]; nextCursor: string | null }> {
    return this.call(`/api/v1/skills${query(opts)}`);
  }

  /** One page of your runs (newest first), cursor-paginated. */
  listRuns(
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{ runs: Run[]; nextCursor: string | null }> {
    return this.call(`/api/v1/runs${query(opts)}`);
  }

  /** Walk every page of the skill catalog (auto-follows cursors). */
  async allSkills(pageSize = 100): Promise<SkillSummary[]> {
    const out: SkillSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listSkills({ limit: pageSize, cursor });
      out.push(...page.skills);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return out;
  }

  /** Verify a run's receipt - public, no API key required. */
  async verify(runId: string): Promise<Verification> {
    try {
      return await this.call<Verification>(`/api/verify/${runId}`, {}, false);
    } catch (e) {
      // A missing receipt is a normal answer, not an error - surface { found: false }.
      if (e instanceof AemulusError && e.status === 404) {
        return { found: false, runId };
      }
      throw e;
    }
  }

  /**
   * Prove ONE field of a run without revealing the others.
   *
   * Returns a bundle anyone can check against the run's committed root — which
   * is anchored on chain — so you can show a counterparty a single total, or a
   * single status, without handing over the run. Owner-only, read scope.
   */
  async disclose(runId: string, field: string): Promise<Disclosure> {
    const r = await this.call<{ disclosure: Disclosure }>(
      `/api/v1/runs/${runId}/disclose?field=${encodeURIComponent(field)}`,
    );
    return r.disclosure;
  }

  /**
   * Check a disclosure bundle. Public — no API key, and it works for a bundle
   * somebody else produced, which is the entire point.
   *
   * `bound` is separate from `valid` on purpose: a proof can be internally
   * consistent and still belong to a tree the sender invented. Only accept it
   * when both are true.
   */
  async verifyDisclosure(
    disclosure: Disclosure,
  ): Promise<{ valid: boolean; bound: boolean; runId?: string }> {
    // The endpoint reads the bundle's fields at the top level, not wrapped in
    // a { disclosure } envelope — spread it, or every check fails the shape
    // test and comes back { valid: false } with nothing to explain why.
    return this.call(
      "/api/disclosures/verify",
      { method: "POST", body: JSON.stringify(disclosure) },
      false,
    );
  }

  /**
   * Watch a page and be told when a value on it changes.
   *
   * A watch is a schedule plus the rule that reads its output, created
   * together — a schedule without a rule burns the allowance every cadence and
   * reports nothing. The cadence is checked against your tier BEFORE the watch
   * exists: an unaffordable one is refused with the list you can actually
   * sustain, rather than accepted and then silently skipped.
   */
  createWatch(opts: {
    skillId: string;
    cadence: Cadence;
    rule: WatchRule;
    input?: Record<string, string>;
    notify?: { channel: "telegram"; chatId: string; redact?: boolean } | null;
  }): Promise<{ id: string; cadence: Cadence; rule: WatchRule }> {
    return this.call("/api/v1/watches", {
      method: "POST",
      body: JSON.stringify(opts),
    });
  }

  /** Every watch you have, with its current value and when it last looked. */
  async listWatches(): Promise<Watch[]> {
    const r = await this.call<{ watches: Watch[] }>("/api/v1/watches");
    return r.watches;
  }

  /** One watch, including how many checks in a row have failed. */
  getWatch(id: string): Promise<Watch> {
    return this.call<Watch>(`/api/v1/watches/${id}`);
  }

  /** Pause or resume. A paused watch keeps everything it has learned. */
  setWatchActive(id: string, active: boolean): Promise<{ id: string; active: boolean }> {
    return this.call(`/api/v1/watches/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    });
  }

  deleteWatch(id: string): Promise<{ id: string; deleted: boolean }> {
    return this.call(`/api/v1/watches/${id}`, { method: "DELETE" });
  }

  /** Run and poll until the run reaches a terminal state (or times out). */
  async runAndWait(
    skillId: string,
    input: Record<string, string> = {},
    opts: { timeoutMs?: number; intervalMs?: number; idempotencyKey?: string } = {},
  ): Promise<Run> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const intervalMs = opts.intervalMs ?? 1_500;
    const started = this.run(skillId, input, {
      idempotencyKey: opts.idempotencyKey,
    });
    const { id } = await started;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const run = await this.getRun(id);
      if (TERMINAL.includes(run.status)) return run;
      if (Date.now() > deadline) {
        throw new AemulusError(`Timed out waiting for run ${id}`, 408);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

export function createClient(opts: AemulusOptions): Aemulus {
  return new Aemulus(opts);
}

/**
 * Check that a webhook delivery really came from Aemulus.
 *
 * Ships here because every integrator otherwise writes this themselves, and the
 * two ways to get it wrong are both silent. Comparing with === leaks timing;
 * ignoring the timestamp means a delivery captured once can be replayed
 * forever. Neither failure is visible until somebody exploits it.
 *
 * Header is `x-aemulus-signature: t=<unix>,sha256=<hex>`, over `${t}.${body}`.
 * Pass the RAW body — parsing and re-serialising changes the bytes and the
 * signature will not match, which is the commonest way this is misused.
 *
 * Uses Web Crypto so it works in Node, Deno, browsers and edge runtimes alike.
 */
export async function verifyWebhook(opts: {
  secret: string;
  /** The x-aemulus-signature header, verbatim. */
  signature: string;
  /** The raw request body, exactly as received. */
  body: string;
  /** How old a delivery may be, in seconds. Default 5 minutes. */
  toleranceSec?: number;
  /** Override for tests. */
  now?: number;
}): Promise<boolean> {
  const m = /^t=(\d+),sha256=([a-f0-9]{64})$/i.exec(opts.signature.trim());
  if (!m) return false;
  const ts = Number(m[1]);
  const given = m[2].toLowerCase();

  const tolerance = opts.toleranceSec ?? 300;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  // Both directions: a timestamp far in the FUTURE is as much a forgery signal
  // as a stale one, and only checking one side leaves the obvious bypass.
  if (Math.abs(now - ts) > tolerance) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(opts.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${ts}.${opts.body}`),
  );
  const expected = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant time. A === on hex strings returns early on the first differing
  // character, which is enough to recover a signature byte by byte.
  if (expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}
