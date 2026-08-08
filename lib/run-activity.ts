import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import { db, ready } from "./db";
import { id as newId } from "./ids";
import { logError, logInfo } from "./log";

const DAY = 86_400_000;

export function runActivityEnabled(): boolean {
  return process.env.AEMULUS_ACTIVITY_RUNS === "1";
}

const NAMES = ["Jordan Lee", "Sam Rivera", "Alex Chen", "Priya Nair", "Casey Kim"];
const VENDORS = ["Acme Corp", "Globex LLC", "Initech", "Umbrella Co", "Soylent Inc"];
const AMOUNTS = ["129.00", "842.50", "1,240.00", "76.20", "399.99"];
function valueFor(field: string, i: number): string {
  const f = field.toLowerCase();
  if (f.includes("amount") || f.includes("price")) return AMOUNTS[i % AMOUNTS.length];
  if (f.includes("email")) return NAMES[i % NAMES.length].toLowerCase().replace(/\s+/g, ".") + "@example.com";
  if (f.includes("name") || f.includes("assignee") || f.includes("requester") || f.includes("owner"))
    return NAMES[i % NAMES.length];
  if (f.includes("vendor") || f.includes("merchant") || f.includes("company") || f.includes("account") || f.includes("customer"))
    return VENDORS[i % VENDORS.length];
  if (f.includes("date") || f.includes("due")) return new Date().toISOString().slice(0, 10);
  return ["Q3 rollout", "Follow-up", "Weekly sync", "Draft v2"][i % 4];
}

interface PlanStep {
  action: string;
  target: string;
  inputKey?: string;
  selectors?: string[];
}

function anonRunner(): string {
  return bs58.encode(randomBytes(32));
}

export async function runActivityTick(now: number): Promise<void> {
  await ready();

  const dayIndex = Math.floor(now / DAY);
  const dayStart = dayIndex * DAY;
  const target = 5 + (dayIndex % 16);
  const elapsedFrac = Math.min(1, Math.max(0, (now - dayStart) / DAY));
  const targetSoFar = Math.max(1, Math.ceil(target * elapsedFrac));

  const doneRow = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM runs WHERE created_at >= ?`,
    args: [dayStart],
  });
  const done = Number(doneRow.rows[0]?.n ?? 0);
  if (done >= targetSoFar) return;

  const skillRows = await db.execute(
    `SELECT id, plan, input_schema FROM skills WHERE published = 1`,
  );
  const skills = skillRows.rows
    .filter((r) => {
      const schema = safeParse<{ template?: { tool?: unknown } }>(
        r.input_schema,
        {},
      );
      return !schema?.template?.tool;
    })
    .map((r) => ({
      id: String(r.id),
      plan: safeParse<PlanStep[]>(r.plan, []),
    }));
  if (skills.length === 0) return;

  let added = 0;
  for (let k = done; k < targetSoFar; k++) {
    const runner = anonRunner();
    const skill = skills[(dayIndex * 3 + k * 7) % skills.length];
    const inputSteps = skill.plan.filter((p) => p.action === "input");
    const host = skill.plan[0]?.target ?? "https://example.com";
    const runId = newId("run");
    const jitter = Math.floor((((k * 2_654_435_761) % 1_000_003) / 1_000_003) * 50 * 60_000);
    const ts = Math.max(dayStart, now - jitter);
    const usedAI = k % 6 === 0;
    const tin = usedAI ? 900 + ((k * 137) % 2400) : 0;
    const tout = usedAI ? 250 + ((k * 53) % 650) : 0;

    const input: Record<string, string> = {};
    inputSteps.forEach((p, i) => (input[p.inputKey ?? `f${i}`] = valueFor(p.inputKey ?? "", i)));

    try {
      await db.execute({
        sql: `INSERT INTO runs (id,owner,skill_id,status,input,overrides,result,error,tokens_in,tokens_out,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [runId, runner, skill.id, "completed", JSON.stringify(input), "{}", "ok", null, tin, tout, ts, ts],
      });

      const steps = [
        { intent: `Open ${hostname(host)}`, type: "navigate", sel: "", value: host, conf: 0.99 },
        ...inputSteps.map((p, i) => ({
          intent: `Enter the ${p.inputKey ?? "field"}`,
          type: "input",
          sel: p.selectors?.[0] ?? "",
          value: valueFor(p.inputKey ?? "", i),
          conf: 0.92 + (i % 7) / 100,
        })),
        { intent: "Submit", type: "click", sel: 'button[type="submit"]', value: "", conf: 0.98 },
      ];
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i];
        await db.execute({
          sql: `INSERT INTO run_steps (id,run_id,idx,intent,action,screenshot,confidence,flagged,note,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)`,
          args: [newId("stp"), runId, i, st.intent,
            JSON.stringify({ type: st.type, selectorUsed: st.sel, value: st.value }),
            null, st.conf, 0, null, ts],
        });
      }

      await db.execute({ sql: `UPDATE skills SET run_count = run_count + 1 WHERE id = ?`, args: [skill.id] });
      added++;
    } catch (e) {
      logError("runs.activity.tick", e);
    }
  }
  if (added > 0) {
    logInfo("runs.activity", `added ${added} run(s) for ${new Date(dayStart).toISOString().slice(0, 10)}`);
  }
}

function hostname(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
}
function safeParse<T>(v: unknown, fallback: T): T {
  try {
    return JSON.parse(String(v ?? "")) as T;
  } catch {
    return fallback;
  }
}

declare global {
  var __aemRunActivity: ReturnType<typeof setInterval> | undefined;
}

export function startRunActivity(): void {
  if (!runActivityEnabled() || globalThis.__aemRunActivity) return;
  const ms = Math.max(60_000, Number(process.env.AEMULUS_ACTIVITY_RUNS_MS) || 3_600_000);
  // .catch, not `void`. A voided promise that rejects is an UNHANDLED REJECTION,
  // which Node terminates the process for — so a transient database blip inside
  // a cosmetic activity ticker would take down the API, the job worker and every
  // in-flight run with it. `await ready()` at the top of the tick sits outside
  // every try/catch in there, which is exactly the call most likely to reject.
  setTimeout(() => {
    runActivityTick(Date.now()).catch((e) => logError("runs.activity.tick", e));
  }, 10_000);
  globalThis.__aemRunActivity = setInterval(() => {
    runActivityTick(Date.now()).catch((e) => logError("runs.activity.tick", e));
  }, ms);
  logInfo("runs.activity", `started (${ms}ms tick)`);
}
