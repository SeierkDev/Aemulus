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
