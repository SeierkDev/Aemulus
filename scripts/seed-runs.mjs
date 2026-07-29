// Seed a realistic Runs history onto specific wallets (e.g. your own demo
// wallets) so their /runs page looks active. Runners are passed at runtime so
// no personal wallet addresses are committed to the repo.
//
//   SEED_RUNNERS='wallet1,wallet2,...' \
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/seed-runs.mjs
//   # or: node scripts/seed-runs.mjs wallet1 wallet2 ...
//
// Idempotent: each wallet's seeded runs use stable ids (seed_run_<w>_<i>) and
// are cleared before re-inserting. Only touches rows with the seed_run_ prefix.
import { createClient } from "@libsql/client";

const runners = (
  process.argv.slice(2).join(",") ||
  process.env.SEED_RUNNERS ||
  ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (runners.length === 0) {
  console.error("No runner wallets given. Pass them as args or SEED_RUNNERS=…");
  process.exit(1);
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "file:./.data/aemulus.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Run against the published skills already in the DB (the marketplace seed).
const skillRows = await db.execute(
  "SELECT id FROM skills WHERE published = 1 ORDER BY id",
);
const skillIds = skillRows.rows.map((r) => String(r.id));
if (skillIds.length === 0) {
  console.error("No published skills found — run scripts/seed-demo.mjs first.");
  process.exit(1);
}

const now = Date.now();
const HOUR = 3_600_000;
let total = 0;

for (let w = 0; w < runners.length; w++) {
  const owner = runners[w];
  // Deterministic per-wallet activity level: 4–15 runs.
  const count = 4 + ((w * 7 + 5) % 12);

  // Clear this wallet's prior seeded runs so re-runs stay clean.
  await db.execute({
    sql: `DELETE FROM runs WHERE owner = ? AND id LIKE 'seed_run_%'`,
    args: [owner],
  });

  for (let i = 0; i < count; i++) {
    const skillId = skillIds[(w * 3 + i * 5) % skillIds.length];
    // ~1 in 12 runs failed; the rest completed (both terminal — no orphaned
    // "needs review" items that can't be resolved without real step data).
    const failed = (i * 5 + w) % 12 === 0 && i > 0;
    const status = failed ? "failed" : "completed";
    // Spread across the last ~2 weeks, newest first.
    const age = i * 9 * HOUR + ((w * 5 + i * 7) % 6) * HOUR + w * 40 * 60_000;
    const ts = now - age;
    await db.execute({
      sql: `INSERT OR REPLACE INTO runs (id,owner,skill_id,status,input,overrides,result,error,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [
        `seed_run_${w}_${i}`,
        owner,
        skillId,
        status,
        "{}",
        "{}",
        status === "completed" ? "ok" : null,
        status === "failed" ? "A step could not be located on the page." : null,
        ts,
        ts,
      ],
    });
    total++;
  }
  console.log(`  ${owner.slice(0, 8)}…  ${count} runs`);
}

console.log(`Seeded ${total} runs across ${runners.length} wallet(s).`);
