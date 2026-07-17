# QBO sandbox smoke test (Batch 1)

Standalone dev tool that proves Aemulus can create a real **Bill** in a
QuickBooks Online **sandbox**. It is **not** imported by the app, touches no
database, and implements no OAuth — it uses a short-lived sandbox token you paste
in. This is the first, riskiest integration step, done in isolation before any
app wiring.

## What it does

1. Preflights the token/realm against `companyinfo`.
2. Resolves the vendor id by `DisplayName` (default `Acme Corp`).
3. Resolves an `Expense` account id.
4. `POST`s a minimal Bill (`INV-2025-0417`, `$1,842.00`, `2025-04-17`) and prints the returned `Bill.Id`.
5. If the vendor isn't found, prints `VENDOR_NOT_FOUND` — the unknown-vendor branch.

## Manual dependency (needs your Intuit account — cannot be automated here)

1. In the Intuit developer portal, open your app's **sandbox company**; copy its **realmId**.
2. In the sandbox UI, create a Vendor named exactly **`Acme Corp`**.
3. Mint a **sandbox access token** in the **OAuth 2.0 Playground** (scope `com.intuit.quickbooks.accounting`).
4. Provide credentials:
   ```bash
   cp scripts/qbo/.env.example scripts/qbo/.env.local
   # edit scripts/qbo/.env.local -> QBO_REALM, QBO_TOKEN
   ```
   `.env.local` is gitignored. Never commit it.

## Run

```bash
npm run qbo:smoke                              # posts the Acme bill
QBO_VENDOR_NAME="Nope Corp" npm run qbo:smoke  # unknown-vendor branch
```

## Success (Batch-1 completion gate)

- A Bill for **Acme Corp · $1,842.00 · INV-2025-0417 · 2025-04-17** is visible in
  **QBO sandbox → Expenses → Bills**, created via query-resolved ids.
- The `Nope Corp` run prints `VENDOR_NOT_FOUND`.

Errors: `401` → remint the token; `Preflight failed` → wrong realm; a `POST /bill`
fault dump → the payload needs adjustment.
