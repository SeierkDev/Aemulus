#!/usr/bin/env node
// Batch-1 QuickBooks Online SANDBOX smoke test.
//
// Creates one Bill in the QBO sandbox using query-resolved vendor + expense-
// account ids, and exercises the unknown-vendor branch. This is a standalone dev
// tool: it is NOT imported by the app, touches no database, and implements no
// OAuth (it uses a short-lived sandbox token you paste in). It contains no
// secrets — credentials come from scripts/qbo/.env.local (gitignored) or env.
//
// Manual dependency (only you can do this — needs your Intuit account):
//   1) Intuit developer app + sandbox company; create a Vendor named "Acme Corp".
//   2) Mint a sandbox access token in the OAuth 2.0 Playground.
//   3) cp scripts/qbo/.env.example scripts/qbo/.env.local  and fill QBO_TOKEN + QBO_REALM.
//
// Run:
//   npm run qbo:smoke                              # posts the Acme bill
//   QBO_VENDOR_NAME="Nope Corp" npm run qbo:smoke  # unknown-vendor branch

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// Load scripts/qbo/.env.local (KEY=VALUE lines) without a dotenv dependency.
function loadEnvLocal() {
  const p = join(HERE, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}
loadEnvLocal();

const BASE = (process.env.QBO_BASE || "https://sandbox-quickbooks.api.intuit.com").replace(/\/+$/, "");
const MV = "73";
console.log("Target:", BASE);
const TOKEN = process.env.QBO_TOKEN;
const REALM = process.env.QBO_REALM;
const VENDOR_NAME = process.env.QBO_VENDOR_NAME || "Acme Corp";

if (!TOKEN || !REALM) {
  console.error("Missing credentials. Fill scripts/qbo/.env.local (QBO_TOKEN, QBO_REALM) or export them, then re-run.");
  process.exit(1);
}

const H = { Authorization: `Bearer ${TOKEN}`, Accept: "application/json", "Content-Type": "application/json" };
const esc = (s) => s.replace(/'/g, "''");

async function http(url, init) {
  try {
    return await fetch(url, init);
  } catch (e) {
    console.error(`Network error reaching QBO sandbox: ${e?.message ?? e}`);
    process.exit(1);
  }
}

async function query(sql) {
  const u = new URL(`${BASE}/v3/company/${REALM}/query`);
  u.searchParams.set("query", sql);
  u.searchParams.set("minorversion", MV);
  const r = await http(u, { headers: H });
  if (r.status === 401) { console.error("401 Unauthorized — token expired or wrong realm. Remint the token."); process.exit(1); }
  return r.json();
}

// 0) Preflight — proves the token + realm are valid before anything else.
{
  const r = await http(`${BASE}/v3/company/${REALM}/companyinfo/${REALM}?minorversion=${MV}`, { headers: H });
  if (!r.ok) { console.error(`Preflight failed: HTTP ${r.status}. Check QBO_TOKEN / QBO_REALM.`); process.exit(1); }
  const j = await r.json();
  console.log("Connected to:", j?.CompanyInfo?.CompanyName ?? "(unknown company)");
}

// 1) Resolve the vendor by name.
const vq = await query(`select * from Vendor where DisplayName = '${esc(VENDOR_NAME)}'`);
const vendor = vq?.QueryResponse?.Vendor?.[0];
if (!vendor) {
  console.log(`VENDOR_NOT_FOUND: no vendor named "${VENDOR_NAME}" in the sandbox.`);
  console.log("-> Unknown-vendor branch confirmed. In the app this becomes a 'vendor not in QuickBooks' failure.");
  process.exit(0);
}
console.log("Vendor:", vendor.DisplayName, "· id", vendor.Id);

// 2) Resolve an expense account.
const aq = await query(`select Id, Name, AccountType from Account where AccountType = 'Expense'`);
const account = aq?.QueryResponse?.Account?.[0];
if (!account) { console.error("No Expense account found in the sandbox."); process.exit(1); }
console.log("Account:", account.Name, "· id", account.Id);

// 3) Create the Bill from the resolved ids.
const bill = {
  VendorRef: { value: vendor.Id },
  TxnDate: "2025-04-17",
  DocNumber: "INV-2025-0417",
  Line: [{
    DetailType: "AccountBasedExpenseLineDetail",
    Amount: 1842.0,
    AccountBasedExpenseLineDetail: { AccountRef: { value: account.Id } },
  }],
};
const r = await http(`${BASE}/v3/company/${REALM}/bill?minorversion=${MV}`, { method: "POST", headers: H, body: JSON.stringify(bill) });
const j = await r.json();
if (!r.ok || !j?.Bill?.Id) {
  console.error(`POST /bill failed: HTTP ${r.status}`);
  console.error(JSON.stringify(j, null, 2));
  process.exit(1);
}
console.log(`\nBill created. Id ${j.Bill.Id} · DocNumber ${j.Bill.DocNumber} · $${j.Bill.TotalAmt}`);
console.log("Confirm in QBO sandbox -> Expenses -> Bills.");
