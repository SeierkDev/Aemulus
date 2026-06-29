import { getSkill, listPublishedSkills, categorize } from "./skills";
import { startRun } from "./run-service";
import { getRun } from "./runs";
import { getQuota } from "./quota";
import { computeTier, getAemulusBalance } from "./solana";
import { verifyReceipt } from "./receipt";
import { rateLimit } from "./ratelimit";
import { hasScope, type Scope } from "./api-keys";
import type { Session } from "./siws";

const RUNS_PER_MIN = Math.max(1, Number(process.env.AEMULUS_RUNS_PER_MIN) || 10);

/**
 * Minimal MCP (Model Context Protocol) server over JSON-RPC. Exposes Aemulus
 * marketplace skills as tools any agent/Claude can call: discover skills, run
 * one with proof, poll a run, and verify a receipt. Authenticated by an Aemulus
 * API key (the route passes the resolved owner wallet in).
 */

const SERVER_INFO = { name: "aemulus", version: "1.0.0" };
const TERMINAL = ["completed", "needs_review", "failed"];

const TOOLS = [
  {
    name: "list_skills",
    description: "List published Aemulus skills you can run, with their inputs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "run_skill",
    description:
      "Run a published skill on an input. Returns its status, extracted output, and a verifiable receipt. Waits briefly for completion.",
    inputSchema: {
      type: "object",
      properties: {
        skillId: { type: "string", description: "The skill id (e.g. skl_…)." },
        input: {
          type: "object",
          description: "Field key → value for the skill's inputs.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["skillId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_run",
    description: "Fetch a run's status, extracted output, and receipt hash.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" } },
      required: ["runId"],
      additionalProperties: false,
    },
  },
  {
    name: "verify_receipt",
    description:
      "Verify a run's receipt: tamper-evident hash + on-chain Merkle membership.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" } },
      required: ["runId"],
      additionalProperties: false,
    },
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type JsonRpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
const ok = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});
const textResult = (data: unknown, isError = false) => ({
  content: [
    { type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) },
  ],
  ...(isError ? { isError: true } : {}),
});

async function callTool(
  owner: string,
  name: string,
  args: Record<string, unknown>,
  scopes: Scope[],
): Promise<unknown> {
  switch (name) {
    case "list_skills": {
      const skills = await listPublishedSkills(100);
      return textResult({
        skills: skills.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          category: categorize(s.name, s.description),
          inputs: s.inputSchema.fields.map((f) => f.key),
        })),
      });
    }
    case "run_skill": {
      if (!hasScope(scopes, "run")) {
        return textResult("API key lacks 'run' scope.", true);
      }
      const skillId = String(args.skillId ?? "");
      const input =
        args.input && typeof args.input === "object"
          ? (args.input as Record<string, string>)
          : {};
      if (!rateLimit(`run:${owner}`, RUNS_PER_MIN, 60_000).ok) {
        return textResult(`Rate limit: max ${RUNS_PER_MIN} runs/min.`, true);
      }
      const skill = await getSkill(skillId);
      if (!skill || (skill.owner !== owner && !skill.published)) {
        return textResult("Skill not found or not runnable.", true);
      }
      const tier = computeTier(await getAemulusBalance(owner));
      const session: Session = {
        pubkey: owner,
        tier: tier.name as Session["tier"],
        level: tier.level,
        balance: 0,
      };
      if (!(await getQuota(session)).ok) {
        return textResult("Daily run quota reached.", true);
      }
      const run = await startRun({ skill, input, runner: owner });
      const deadline = Date.now() + 25_000; // bounded wait for a quick answer
      let cur = run;
      while (!TERMINAL.includes(cur.status) && Date.now() < deadline) {
        await sleep(1_000);
        cur = (await getRun(run.id)) ?? cur;
      }
      return textResult({
        runId: run.id,
        status: cur.status,
        output: cur.output,
        receiptHash: cur.receiptHash,
        verifyUrl: `/verify/${run.id}`,
      });
    }
    case "get_run": {
      const run = await getRun(String(args.runId ?? ""));
      if (!run || run.owner !== owner) return textResult("Run not found.", true);
      return textResult({
        runId: run.id,
        status: run.status,
        output: run.output,
        receiptHash: run.receiptHash,
      });
    }
    case "verify_receipt":
      return textResult(await verifyReceipt(String(args.runId ?? "")));
    default:
      return textResult(`Unknown tool: ${name}`, true);
  }
}

/** Handle one JSON-RPC message. Returns null for notifications (no response). */
export async function handleMcp(
  owner: string,
  msg: JsonRpc,
  scopes: Scope[] = ["read", "run"],
): Promise<object | null> {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
    return rpcErr(null, -32600, "Invalid Request");
  }
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      const name = String(params?.name ?? "");
      const args = (params?.arguments as Record<string, unknown>) ?? {};
      try {
        return ok(id, await callTool(owner, name, args, scopes));
      } catch (e) {
        return ok(id, textResult(e instanceof Error ? e.message : "Tool failed", true));
      }
    }
    case "ping":
      return ok(id, {});
    case "notifications/initialized":
      return null; // notification - no response
    default:
      return rpcErr(id, -32601, `Method not found: ${method}`);
  }
}
