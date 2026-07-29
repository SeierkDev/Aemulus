import { db, ready } from "./db";
import { creditEarningOnce } from "./earnings";
import { id as newId } from "./ids";
import { SOLANA } from "./solana";
import { logError, logInfo } from "./log";

// Optional marketplace run-activity generator. When AEMULUS_ACTIVITY_RUNS=1
// (and AEMULUS_ACTIVITY_WALLETS lists wallet pubkeys), it adds a handful of
// completed runs — with per-step records + creator earnings — against the
// published skills each day, so a fresh pre-launch deployment keeps showing
// recent activity. Rows use native ids and never touch the interactive run
// pipeline. Off by default.

const DAY = 86_400_000;

function activityWallets(): string[] {
  return (process.env.AEMULUS_ACTIVITY_WALLETS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function runActivityEnabled(): boolean {
  return process.env.AEMULUS_ACTIVITY_RUNS === "1" && activityWallets().length > 0;
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

/** Add today's batch of activity runs if it hasn't been added yet. Idempotent per UTC day. */
export async function runActivityTick(now: number): Promise<void> {
  const wallets = activityWallets();
  if (wallets.length === 0) return;
  await ready();

  const dayIndex = Math.floor(now / DAY);
  const dayStart = dayIndex * DAY;
  const target = 5 + (dayIndex % 11); // 5..15 per day

  // Count this fleet's runs already recorded today, so a restart mid-day doesn't
  // double the batch.
  const ph = wallets.map(() => "?").join(",");
  const doneRow = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM runs WHERE owner IN (${ph}) AND created_at >= ?`,
    args: [...wallets, dayStart],
  });
  const done = Number(doneRow.rows[0]?.n ?? 0);
  if (done >= target) return;

  const skillRows = await db.execute(
    `SELECT id, owner, plan FROM skills WHERE published = 1`,
  );
  if (skillRows.rows.length === 0) return;
  const skills = skillRows.rows.map((r) => ({
    id: String(r.id),
    owner: String(r.owner ?? ""),
    plan: safeParse<PlanStep[]>(r.plan, []),
  }));

  let added = 0;
  for (let k = done; k < target; k++) {
    const runner = wallets[(dayIndex + k) % wallets.length];
    let sIdx = (dayIndex * 3 + k * 7) % skills.length;
    if (skills[sIdx].owner === runner) sIdx = (sIdx + 1) % skills.length;
    const skill = skills[sIdx];
    const inputSteps = skill.plan.filter((p) => p.action === "input");
    const host = skill.plan[0]?.target ?? "https://example.com";
    const runId = newId("run");
    const ts = now - Math.floor(((k * 37) % 600) * 1000); // slight spread within the batch

    const input: Record<string, string> = {};
    inputSteps.forEach((p, i) => (input[p.inputKey ?? `f${i}`] = valueFor(p.inputKey ?? "", i)));

    try {
      await db.execute({
        sql: `INSERT INTO runs (id,owner,skill_id,status,input,overrides,result,error,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`,
        args: [runId, runner, skill.id, "completed", JSON.stringify(input), "{}", "ok", null, ts, ts],
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

      // Keep the marketplace count consistent with the actual rows.
      await db.execute({ sql: `UPDATE skills SET run_count = run_count + 1 WHERE id = ?`, args: [skill.id] });

      // Creator earning (first time this runner ran this skill only).
      if (skill.owner && skill.owner !== runner) {
        await creditEarningOnce({ owner: skill.owner, skillId: skill.id, runId, runner, amount: SOLANA.runFee });
      }
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
  setTimeout(() => void runActivityTick(Date.now()), 10_000);
  globalThis.__aemRunActivity = setInterval(() => void runActivityTick(Date.now()), ms);
  logInfo("runs.activity", `started (${ms}ms tick)`);
}
