import { db, ready } from "../db";

// Aemulus's own lightweight ledger. When QuickBooks isn't connected, entered
// invoices are recorded here as real, inspectable bills (and still sealed +
// verifiable via the audit stream). One bill per invoice (invoice_id UNIQUE), so
// re-entering the same invoice returns the existing bill.

const DDL = `
  CREATE TABLE IF NOT EXISTS ledger_bill (
    bill_no     INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id  TEXT NOT NULL UNIQUE,
    vendor      TEXT NOT NULL,
    doc_number  TEXT NOT NULL,
    amount      REAL NOT NULL,
    currency    TEXT NOT NULL,
    entered_at  INTEGER NOT NULL
  )`;

let ensured: Promise<void> | null = null;
export function ensureLedgerSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ready();
      await db.execute(DDL);
    })();
  }
  return ensured;
}

export interface LedgerBillInput {
  invoiceId: string;
  vendor: string;
  docNumber: string;
  amount: number;
  currency: string;
  now: number;
}

export interface LedgerBill {
  billNumber: string;
  vendor: string;
  docNumber: string;
  amount: number;
  currency: string;
  enteredAt: number;
}

const billNumber = (no: number) => `AEM-${no}`;

/** Record (or return the existing) ledger bill for an invoice. Idempotent. */
export async function recordLedgerBill(input: LedgerBillInput): Promise<{ billNumber: string }> {
  await ensureLedgerSchema();
  const ins = await db.execute({
    sql: `INSERT OR IGNORE INTO ledger_bill (invoice_id, vendor, doc_number, amount, currency, entered_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [input.invoiceId, input.vendor, input.docNumber, input.amount, input.currency, input.now],
  });
  if (ins.rowsAffected === 1) return { billNumber: billNumber(Number(ins.lastInsertRowid)) };
  const r = await db.execute({ sql: `SELECT bill_no FROM ledger_bill WHERE invoice_id = ?`, args: [input.invoiceId] });
  return { billNumber: billNumber(Number(r.rows[0].bill_no)) };
}

/** Recent ledger bills, newest first. */
export async function listLedgerBills(limit = 50): Promise<LedgerBill[]> {
  await ensureLedgerSchema();
  const r = await db.execute({
    sql: `SELECT * FROM ledger_bill ORDER BY bill_no DESC LIMIT ?`,
    args: [limit],
  });
  return r.rows.map((row) => ({
    billNumber: billNumber(Number(row.bill_no)),
    vendor: String(row.vendor),
    docNumber: String(row.doc_number),
    amount: Number(row.amount),
    currency: String(row.currency),
    enteredAt: Number(row.entered_at),
  }));
}
