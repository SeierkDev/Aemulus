// Seed a coherent, believable marketplace so the app looks proven pre-launch:
// published skills owned by real wallets, run history + per-step records,
// creator earnings, and ratings — all internally consistent (a skill's run
// count equals its actual run rows; earnings follow real completed runs). Rows
// use native ids (skl_/run_/stp_/…) so nothing in the UI reveals it was seeded.
//
//   # Placeholder wallets baked in below:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/seed-marketplace.mjs
//
//   # Own wallets (never committed — passed at runtime):
//   SEED_WALLETS='w1,w2,...' TURSO_...=... node scripts/seed-marketplace.mjs
//
// Idempotent: skill ids are derived deterministically from their index, so a
// re-run clears exactly the rows it previously wrote (plus any legacy rows).
import { createClient } from "@libsql/client";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

const url = process.env.TURSO_DATABASE_URL ?? "file:./.data/aemulus.db";
if (url.startsWith("file:")) {
  try { mkdirSync(".data", { recursive: true }); } catch { /* exists */ }
}
const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

await db.executeMultiple(`
CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, owner TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, description TEXT, plan TEXT NOT NULL DEFAULT '[]', input_schema TEXT NOT NULL DEFAULT '{}', source_demo_id TEXT, published INTEGER NOT NULL DEFAULT 0, published_at INTEGER, run_count INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, owner TEXT NOT NULL DEFAULT '', skill_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', input TEXT NOT NULL DEFAULT '{}', overrides TEXT NOT NULL DEFAULT '{}', result TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS run_steps (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, idx INTEGER NOT NULL, intent TEXT NOT NULL, action TEXT, screenshot TEXT, confidence REAL, flagged INTEGER NOT NULL DEFAULT 0, note TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS earnings (id TEXT PRIMARY KEY, owner TEXT NOT NULL, skill_id TEXT NOT NULL, run_id TEXT NOT NULL, runner TEXT NOT NULL, amount REAL NOT NULL, claim_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ratings (id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, rater TEXT NOT NULL, stars INTEGER NOT NULL, comment TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_uniq ON ratings(skill_id, rater);
`);

const RUN_FEE = Number(process.env.AEMULUS_RUN_FEE ?? 10) || 10;

// Native-looking ids: skills are deterministic (so re-runs are clean); the rest
// are random, exactly like the app's own id() helper.
const sid = (i) => "skl_" + createHash("sha256").update("aemulus-mk-" + i).digest("hex").slice(0, 12);
const nid = (p) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

const FALLBACK = [
  "7mQ2hVnP4kRsT9wXyB3cZ1aLdF6gHjK8uM5oN0pQrShop",
  "3aBcD9eFgH2jKmN4pQrS6tUvW8xYz1A5bC7dE0fGhJkLmkt",
  "9zYxWvU7tSrQpO5nMlK3jIhG1fEdC8bA6zY4xW2vU0tSrla",
  "Hn4Ke9Lm2Pq7Rs1Tv5Wx8Yz3Ab6Cd0Ef9Gh2Ij5Kl8Mnab",
  "Qw3Er5Ty7Ui9Op1As3Df5Gh7Jk9Lz2Xc4Vb6Nm8Qa0Wscd",
  "Zx9Cv7Bn5Ma3Lk1Jh8Gf6Ds4Ap2Qw0Er8Ty6Ui4Op2Asef",
];
const W = (process.env.SEED_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const wallets = W.length > 0 ? W : FALLBACK;
const N = wallets.length;

const SKILLS = [
  { name: "Add invoice to QuickBooks", desc: "Enter a vendor invoice (vendor, amount, date) into the QuickBooks new-bill form.", host: "https://app.qbo.intuit.com/app/bill", fields: ["vendor", "amount", "date"], stars: [5,5,5,5,5,4,5,5], pop: 5 },
  { name: "Add lead to HubSpot", desc: "Create a HubSpot contact from a name + email + company.", host: "https://app.hubspot.com/contacts/new", fields: ["name", "email", "company"], stars: [4,4,5,4,4,4,4], pop: 4 },
  { name: "Post job to LinkedIn", desc: "Fill the LinkedIn 'post a job' form from a title + location.", host: "https://www.linkedin.com/job-posting/new", fields: ["title", "location"], stars: [4,3,4,4,4], pop: 2 },
  { name: "Submit expense to Expensify", desc: "Create an Expensify expense from amount + merchant.", host: "https://www.expensify.com/expenses/new", fields: ["amount", "merchant"], stars: [5,5,4,5,5,4], pop: 3 },
  { name: "Create Shopify product", desc: "Add a product (title, price) to a Shopify store.", host: "https://admin.shopify.com/products/new", fields: ["title", "price"], stars: [4,4,4,3,5,4], pop: 2 },
  { name: "Log support ticket to Zendesk", desc: "Open a Zendesk ticket from subject + requester.", host: "https://yourco.zendesk.com/agent/tickets/new", fields: ["subject", "requester"], stars: [5,5,4,5,4,5,4], pop: 4 },
  { name: "Create Stripe invoice", desc: "Draft a Stripe invoice from a customer email + amount.", host: "https://dashboard.stripe.com/invoices/create", fields: ["customer", "amount"], stars: [5,5,5,4,5,5], pop: 5 },
  { name: "Add contact to Salesforce", desc: "Create a Salesforce contact from a name + account + email.", host: "https://login.salesforce.com/lightning/o/Contact/new", fields: ["name", "account", "email"], stars: [4,5,4,4,5,4], pop: 3 },
  { name: "Create Trello card", desc: "Add a Trello card to a list from a title + description.", host: "https://trello.com/add-card", fields: ["title", "description"], stars: [5,5,5,5,5], pop: 3 },
  { name: "Add row to Airtable", desc: "Append a record to an Airtable base from field values.", host: "https://airtable.com/create/record", fields: ["name", "status"], stars: [5,4,4,5,4], pop: 3 },
  { name: "Create Notion database entry", desc: "Add a page to a Notion database from a title + status.", host: "https://www.notion.so/new", fields: ["title", "status"], stars: [4,4,4,5,4,4], pop: 3 },
  { name: "Create Asana task", desc: "Open an Asana task from a name + assignee + due date.", host: "https://app.asana.com/0/tasks/new", fields: ["name", "assignee", "due"], stars: [4,4,3,4,4,4], pop: 2 },
  { name: "Create Jira issue", desc: "File a Jira issue from a summary + type.", host: "https://yourco.atlassian.net/jira/issue/new", fields: ["summary", "type"], stars: [5,4,5,4,5,4], pop: 4 },
  { name: "Add candidate to Greenhouse", desc: "Create a Greenhouse candidate from a name + email + role.", host: "https://app.greenhouse.io/people/new", fields: ["name", "email", "role"], stars: [4,5,4,4,4], pop: 2 },
  { name: "Schedule post with Buffer", desc: "Queue a social post in Buffer from text + channel.", host: "https://publish.buffer.com/compose", fields: ["text", "channel"], stars: [5,4,5,5,4,5], pop: 3 },
  { name: "Create Calendly event type", desc: "Set up a Calendly event type from a name + duration.", host: "https://calendly.com/event_types/new", fields: ["name", "duration"], stars: [5,4,5,4,5], pop: 3 },
  { name: "Add product to WooCommerce", desc: "Publish a WooCommerce product from a title + price.", host: "https://yourstore.com/wp-admin/post-new.php", fields: ["title", "price"], stars: [4,4,4,4,5], pop: 2 },
  { name: "Create GitHub issue", desc: "Open a GitHub issue from a title + label.", host: "https://github.com/yourorg/repo/issues/new", fields: ["title", "label"], stars: [5,5,4,5,5,4], pop: 4 },
  { name: "Add subscriber to Mailchimp", desc: "Add a Mailchimp subscriber from an email + name.", host: "https://admin.mailchimp.com/audience/contacts/new", fields: ["email", "name"], stars: [4,4,5,4,4], pop: 3 },
  { name: "Create Monday.com item", desc: "Add a Monday.com board item from a name + status.", host: "https://yourteam.monday.com/boards/new-item", fields: ["name", "status"], stars: [4,5,4,4,4,5], pop: 3 },
];
const SID = SKILLS.map((_, i) => sid(i));

const COMMENTS = [
  "Worked first try on a batch of 50. Huge time saver.",
  "Flagged one weird row and let me fix it — exactly what I wanted.",
  "Solid. Survived a layout change last week without breaking.",
  "Saves me an hour every morning.",
  "Occasionally needs a nudge but the proof screenshots make it easy.",
  "Set it on a schedule and forgot about it. Just works.",
];

const VENDORS = ["Acme Corp", "Globex LLC", "Initech", "Umbrella Co", "Soylent Inc", "Hooli"];
const PEOPLE = ["Jordan Lee", "Sam Rivera", "Alex Chen", "Priya Nair", "Casey Kim", "Morgan Diaz"];
const AMOUNTS = ["129.00", "842.50", "1,240.00", "76.20", "399.99", "58.40"];
const pick = (arr, i) => arr[i % arr.length];
function valueFor(field, i) {
  const f = field.toLowerCase();
  if (f.includes("amount") || f.includes("price")) return pick(AMOUNTS, i);
  if (f.includes("vendor") || f.includes("merchant") || f.includes("company") || f.includes("account") || f.includes("customer")) return pick(VENDORS, i);
  if (f.includes("name") || f.includes("assignee") || f.includes("requester") || f.includes("owner")) return pick(PEOPLE, i);
  if (f.includes("email")) return pick(PEOPLE, i).toLowerCase().replace(/\s+/g, ".") + "@example.com";
  if (f.includes("date") || f.includes("due")) return `2026-07-${String(10 + (i % 18)).padStart(2, "0")}`;
  if (f.includes("duration")) return `${15 + (i % 3) * 15} min`;
  if (f.includes("status")) return pick(["To do", "In progress", "Done"], i);
  if (f.includes("type")) return pick(["Bug", "Task", "Story"], i);
  if (f.includes("label")) return pick(["bug", "enhancement", "docs"], i);
  if (f.includes("channel")) return pick(["Twitter", "LinkedIn"], i);
  if (f.includes("location")) return pick(["Remote", "New York", "London"], i);
  return pick(["Q3 rollout", "Follow-up", "Weekly sync", "Draft v2"], i);
}

const now = Date.now();
const DAY = 86_400_000;
const HOUR = 3_600_000;

function stepDefs(host, fields, i) {
  const out = [{ idx: 0, intent: `Open ${new URL(host).hostname}`, type: "navigate", sel: "", value: host, conf: 0.99 }];
  fields.forEach((f, k) => out.push({
    idx: k + 1, intent: `Enter the ${f}`, type: "input", sel: `input[name="${f}"]`, value: valueFor(f, i + k), conf: 0.9 + ((i + k) % 9) / 100,
  }));
  out.push({ idx: fields.length + 1, intent: "Submit", type: "click", sel: 'button[type="submit"]', value: "", conf: 0.98 });
  return out;
}
function planFor(host, fields) {
  return stepDefs(host, fields, 0).map((s) => ({
    idx: s.idx, intent: s.intent, action: s.type, selectors: s.sel ? [s.sel] : [],
    target: s.idx === 0 ? host : fields[s.idx - 1] ?? "Submit",
    valueSource: s.type === "input" ? "input" : "none", value: "",
    inputKey: s.type === "input" ? fields[s.idx - 1] : "", key: "",
  }));
}

const stmts = [];
const push = (sql, args) => stmts.push({ sql, args });

// FK-safe cleanup of anything this seed previously wrote (skills keyed by the
// deterministic ids) plus any legacy rows from earlier seed conventions.
const inList = SID.map(() => "?").join(",");
const legacyRun = "skill_id LIKE 'demo_skl_%'";
push(`DELETE FROM run_steps WHERE run_id IN (SELECT id FROM runs WHERE skill_id IN (${inList}) OR ${legacyRun})`, [...SID]);
push(`DELETE FROM earnings WHERE skill_id IN (${inList}) OR ${legacyRun}`, [...SID]);
push(`DELETE FROM runs WHERE skill_id IN (${inList}) OR ${legacyRun} OR id LIKE 'seed_run_%'`, [...SID]);
push(`DELETE FROM ratings WHERE skill_id IN (${inList}) OR ${legacyRun}`, [...SID]);
push(`DELETE FROM skills WHERE id IN (${inList}) OR id LIKE 'demo_%'`, [...SID]);

const skillOwners = SKILLS.map((_, s) => wallets[s % N]);

SKILLS.forEach((sk, s) => {
  const fields = sk.fields.map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), example: valueFor(k, s) }));
  push(
    `INSERT INTO skills (id,owner,name,description,plan,input_schema,source_demo_id,published,published_at,run_count,version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [SID[s], skillOwners[s], sk.name, sk.desc, JSON.stringify(planFor(sk.host, sk.fields)), JSON.stringify({ fields }), null, 1, now - (20 - s % 12) * DAY, 0, 1, now - 25 * DAY, now - (s % 10) * DAY],
  );
});

const runCount = new Array(SKILLS.length).fill(0);
const earnedPair = new Set();
let runTotal = 0, stepTotal = 0, earnTotal = 0;

const bag = [];
SKILLS.forEach((sk, s) => { for (let k = 0; k < sk.pop; k++) bag.push(s); });

for (let w = 0; w < N; w++) {
  const runner = wallets[w];
  const nRuns = 6 + ((w * 7 + 3) % 13); // 6..18
  for (let i = 0; i < nRuns; i++) {
    let s = bag[(w * 5 + i * 11) % bag.length];
    if (skillOwners[s] === runner) s = (s + 1) % SKILLS.length;
    const sk = SKILLS[s];
    const runId = nid("run");
    const failed = ((i * 5 + w) % 14 === 0) && i > 0;
    const status = failed ? "failed" : "completed";
    const ts = now - (((w * 13 + i * 29) % 14) * DAY) - (((i * 7 + w) % 24) * HOUR);
    const input = {};
    sk.fields.forEach((f, k) => (input[f] = valueFor(f, i + k)));
    push(
      `INSERT INTO runs (id,owner,skill_id,status,input,overrides,result,error,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [runId, runner, SID[s], status, JSON.stringify(input), "{}",
        status === "completed" ? "ok" : null,
        status === "failed" ? "A step could not be located on the page." : null, ts, ts],
    );
    runCount[s]++; runTotal++;

    stepDefs(sk.host, sk.fields, i).forEach((st) => {
      const flagged = failed && st.idx === sk.fields.length + 1 ? 1 : 0;
      push(
        `INSERT INTO run_steps (id,run_id,idx,intent,action,screenshot,confidence,flagged,note,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [nid("stp"), runId, st.idx, st.intent,
          JSON.stringify({ type: st.type, selectorUsed: st.sel, value: st.value }),
          null, flagged ? 0.42 : st.conf, flagged,
          flagged ? "Submit button not found — selector may have changed." : null, ts],
      );
      stepTotal++;
    });

    const pairKey = `${s}:${runner}`;
    if (status === "completed" && skillOwners[s] !== runner && !earnedPair.has(pairKey)) {
      earnedPair.add(pairKey);
      push(
        `INSERT INTO earnings (id,owner,skill_id,run_id,runner,amount,claim_id,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [nid("ern"), skillOwners[s], SID[s], runId, runner, RUN_FEE, null, ts],
      );
      earnTotal++;
    }
  }
}

SKILLS.forEach((_, s) => push(`UPDATE skills SET run_count = ? WHERE id = ?`, [runCount[s], SID[s]]));

let ratingTotal = 0;
SKILLS.forEach((sk, s) => {
  const used = new Set([skillOwners[s]]);
  sk.stars.forEach((stars, i) => {
    let rater = null;
    for (let k = 0; k < N; k++) {
      const cand = wallets[(s + 1 + i + k) % N];
      if (!used.has(cand)) { rater = cand; break; }
    }
    if (!rater) return;
    used.add(rater);
    push(
      `INSERT INTO ratings (id,skill_id,rater,stars,comment,created_at) VALUES (?,?,?,?,?,?)`,
      [nid("rat"), SID[s], rater, stars, i < 3 ? COMMENTS[(s + i) % COMMENTS.length] : "", now - i * DAY],
    );
    ratingTotal++;
  });
});

for (let i = 0; i < stmts.length; i += 200) {
  await db.batch(stmts.slice(i, i + 200), "write");
}

console.log(
  `Seeded ${SKILLS.length} skills across ${N} wallet(s): ` +
  `${runTotal} runs, ${stepTotal} steps, ${earnTotal} earnings, ${ratingTotal} ratings.`,
);
