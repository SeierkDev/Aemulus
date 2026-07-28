// Seed believable demo content (published skills + run history + ratings) so
// the marketplace looks proven pre-launch. Idempotent (stable ids).
//   node scripts/seed-demo.mjs
import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";

const url = process.env.TURSO_DATABASE_URL ?? "file:./.data/aemulus.db";
if (url.startsWith("file:")) {
  try {
    mkdirSync(".data", { recursive: true });
  } catch {
    /* exists */
  }
}
const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

await db.executeMultiple(`
CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, owner TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, description TEXT, plan TEXT NOT NULL DEFAULT '[]', input_schema TEXT NOT NULL DEFAULT '{}', source_demo_id TEXT, published INTEGER NOT NULL DEFAULT 0, published_at INTEGER, run_count INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, owner TEXT NOT NULL DEFAULT '', skill_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', input TEXT NOT NULL DEFAULT '{}', overrides TEXT NOT NULL DEFAULT '{}', result TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ratings (id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, rater TEXT NOT NULL, stars INTEGER NOT NULL, comment TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_uniq ON ratings(skill_id, rater);
`);

const CREATORS = [
  "7mQ2hVnP4kRsT9wXyB3cZ1aLdF6gHjK8uM5oN0pQrShop",
  "3aBcD9eFgH2jKmN4pQrS6tUvW8xYz1A5bC7dE0fGhJkLmkt",
  "9zYxWvU7tSrQpO5nMlK3jIhG1fEdC8bA6zY4xW2vU0tSrla",
];
const RUNNERS = [
  "Hn4Ke9Lm2Pq7Rs1Tv5Wx8Yz3Ab6Cd0Ef9Gh2Ij5Kl8Mnab",
  "Qw3Er5Ty7Ui9Op1As3Df5Gh7Jk9Lz2Xc4Vb6Nm8Qa0Wscd",
  "Zx9Cv7Bn5Ma3Lk1Jh8Gf6Ds4Ap2Qw0Er8Ty6Ui4Op2Asef",
  "Pl0Ok9Ij8Uh7Yg6Tf5Rd4Es3Wa2Qz1Xc0Vb9Nm8Lk7Jhgh",
  "Mn6Bv4Cx2Zl0Kj9Hg7Fd5Sa3Qp1Wo8Ei6Ru4Yt2Op0Asij",
  "Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz3Ab4Cdkl",
  "Rs5Tu6Vw7Xy8Za9Bc0De1Fg2Hi3Jk4Lm5No6Pq7Rs8Tumn",
  "Uv9Wx0Yz1Ab2Cd3Ef4Gh5Ij6Kl7Mn8Op9Qr0St1Uv2Wxop",
  "Gh3Ij4Kl5Mn6Op7Qr8St9Uv0Wx1Yz2Ab3Cd4Ef5Gh6Ijqr",
  "Jk7Lm8No9Pq0Rs1Tu2Vw3Xy4Za5Bc6De7Fg8Hi9Jk0Lmst",
  "No1Pq2Rs3Tu4Vw5Xy6Za7Bc8De9Fg0Hi1Jk2Lm3No4Pquv",
  "Tu5Vw6Xy7Za8Bc9De0Fg1Hi2Jk3Lm4No5Pq6Rs7Tu8Vwwx",
];

const SKILLS = [
  { name: "Add invoice to QuickBooks", desc: "Enter a vendor invoice (vendor, amount, date) into the QuickBooks new-bill form.", host: "https://app.qbo.intuit.com/app/bill", fields: ["vendor", "amount", "date"], runs: 412, success: 0.97, stars: [5,5,5,4,5,5,4,5] },
  { name: "Add lead to HubSpot", desc: "Create a HubSpot contact from a name + email + company.", host: "https://app.hubspot.com/contacts/new", fields: ["name", "email", "company"], runs: 318, success: 0.94, stars: [5,4,5,5,4,5,5] },
  { name: "Post job to LinkedIn", desc: "Fill the LinkedIn 'post a job' form from a title + location + description.", host: "https://www.linkedin.com/job-posting/new", fields: ["title", "location"], runs: 156, success: 0.9, stars: [4,5,4,5,4] },
  { name: "Submit expense to Expensify", desc: "Create an Expensify expense from amount + merchant + category.", host: "https://www.expensify.com/expenses/new", fields: ["amount", "merchant"], runs: 203, success: 0.96, stars: [5,5,5,5,4,5] },
  { name: "Create Shopify product", desc: "Add a product (title, price, description) to a Shopify store.", host: "https://admin.shopify.com/products/new", fields: ["title", "price"], runs: 88, success: 0.89, stars: [4,4,5,4] },
  { name: "Log support ticket to Zendesk", desc: "Open a Zendesk ticket from subject + requester + priority.", host: "https://yourco.zendesk.com/agent/tickets/new", fields: ["subject", "requester"], runs: 271, success: 0.95, stars: [5,5,4,5,5,4,5,5] },
  { name: "Create Stripe invoice", desc: "Draft a Stripe invoice from a customer email + amount + memo.", host: "https://dashboard.stripe.com/invoices/create", fields: ["customer", "amount"], runs: 344, success: 0.96, stars: [5,5,5,4,5,5,5] },
  { name: "Add contact to Salesforce", desc: "Create a Salesforce contact from a name + account + email.", host: "https://login.salesforce.com/lightning/o/Contact/new", fields: ["name", "account", "email"], runs: 289, success: 0.93, stars: [4,5,5,4,5,5] },
  { name: "Create Trello card", desc: "Add a Trello card to a list from a title + description.", host: "https://trello.com/add-card", fields: ["title", "description"], runs: 176, success: 0.98, stars: [5,5,5,5,5,4] },
  { name: "Add row to Airtable", desc: "Append a record to an Airtable base from a set of field values.", host: "https://airtable.com/create/record", fields: ["name", "status", "notes"], runs: 233, success: 0.95, stars: [5,4,5,5,5] },
  { name: "Create Notion database entry", desc: "Add a page to a Notion database from a title + tags + status.", host: "https://www.notion.so/new", fields: ["title", "status"], runs: 198, success: 0.94, stars: [5,5,4,5,4,5] },
  { name: "Create Asana task", desc: "Open an Asana task from a name + assignee + due date.", host: "https://app.asana.com/0/tasks/new", fields: ["name", "assignee", "due"], runs: 142, success: 0.92, stars: [4,5,4,5,5] },
  { name: "Create Jira issue", desc: "File a Jira issue from a summary + type + priority.", host: "https://yourco.atlassian.net/jira/issue/new", fields: ["summary", "type"], runs: 261, success: 0.95, stars: [5,5,4,5,5,4,5] },
  { name: "Add candidate to Greenhouse", desc: "Create a Greenhouse candidate from a name + email + role.", host: "https://app.greenhouse.io/people/new", fields: ["name", "email", "role"], runs: 97, success: 0.9, stars: [4,4,5,4,5] },
  { name: "Schedule post with Buffer", desc: "Queue a social post in Buffer from text + channel + time.", host: "https://publish.buffer.com/compose", fields: ["text", "channel"], runs: 184, success: 0.93, stars: [5,4,5,4,5,5] },
];

const COMMENTS = [
  "Worked first try on a batch of 50. Huge time saver.",
  "Flagged one weird row and let me fix it - exactly what I wanted.",
  "Solid. Survived a layout change last week without breaking.",
  "Saves me an hour every morning.",
  "Occasionally needs a nudge but the proof screenshots make it easy.",
];

const now = Date.now();
const DAY = 86_400_000;

function planFor(host, fields) {
  const steps = [
    { idx: 0, intent: `Open ${new URL(host).hostname}`, action: "navigate", selectors: [], target: host, valueSource: "none", value: "", inputKey: "", key: "" },
  ];
  fields.forEach((f, i) =>
    steps.push({ idx: i + 1, intent: `Enter the ${f}`, action: "input", selectors: [`input[name="${f}"]`], target: f, valueSource: "input", value: "", inputKey: f, key: "" }),
  );
  steps.push({ idx: fields.length + 1, intent: "Submit", action: "click", selectors: ['button[type="submit"]'], target: "Submit", valueSource: "none", value: "", inputKey: "", key: "" });
  return steps;
}

let s = 0;
for (const sk of SKILLS) {
  const sid = `demo_skl_${s}`;
  const owner = CREATORS[s % CREATORS.length];
  const fields = sk.fields.map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), example: k === "amount" || k === "price" ? "129.00" : k }));
  await db.execute({
    sql: `INSERT OR REPLACE INTO skills (id,owner,name,description,plan,input_schema,source_demo_id,published,published_at,run_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [sid, owner, sk.name, sk.desc, JSON.stringify(planFor(sk.host, sk.fields)), JSON.stringify({ fields }), null, 1, now - 20 * DAY + s * DAY, sk.runs, now - 25 * DAY, now - s * DAY],
  });
  // Run history that produces ~sk.success completion rate (cap rows for speed).
  const rows = Math.min(40, sk.runs);
  const fails = Math.round(rows * (1 - sk.success));
  await db.execute({ sql: `DELETE FROM runs WHERE skill_id = ? AND id LIKE 'demo_run_%'`, args: [sid] });
  for (let i = 0; i < rows; i++) {
    const status = i < fails ? (i % 2 === 0 ? "needs_review" : "failed") : "completed";
    await db.execute({
      sql: `INSERT OR REPLACE INTO runs (id,owner,skill_id,status,input,overrides,result,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [`demo_run_${s}_${i}`, RUNNERS[i % RUNNERS.length], sid, status, "{}", "{}", status === "completed" ? "ok" : null, null, now - i * 3_600_000, now - i * 3_600_000],
    });
  }
  // Ratings.
  for (let i = 0; i < sk.stars.length; i++) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO ratings (id,skill_id,rater,stars,comment,created_at) VALUES (?,?,?,?,?,?)`,
      args: [`demo_rat_${s}_${i}`, sid, RUNNERS[i % RUNNERS.length], sk.stars[i], i < 3 ? COMMENTS[(s + i) % COMMENTS.length] : "", now - i * DAY],
    });
  }
  s++;
}

console.log(`Seeded ${SKILLS.length} demo skills with run history + ratings.`);
