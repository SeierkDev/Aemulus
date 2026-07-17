import { db, ready } from "../db";
import { DEFAULT_WORKSPACE } from "./workspace";

// Aemulus's own lightweight ledger, scoped per workspace. When QuickBooks isn't
// connected, entered invoices are recorded here as real, inspectable bills (and
// still sealed + verifiable via the audit stream). One bill per invoice within a
// workspace, so re-entering the same invoice returns the existing bill.

const DDL = `
  CREATE TABLE IF NOT EXISTS ledger_bill (
    bill_no      INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE}',
    invoice_id   TEXT NOT NULL,
    vendor       TEXT NOT NULL,
    doc_number   TEXT NOT NULL,
    amount       REAL NOT NULL,
    currency     TEXT NOT NULL,
    entered_at   INTEGER NOT NULL,
    UNIQUE (workspace_id, invoice_id)
  )`;

let ensured: Promise<void> | null = null;
export function ensureLedgerSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      try {
        await ready();
        const legacy = await db.execute(`PRAGMA table_info(ledger_bill_legacy)`);
        const mainPre = await db.execute(`PRAGMA table_info(ledger_bill)`);
        if (legacy.rows.length > 0 && mainPre.rows.length === 0) {
          await db.execute(`ALTER TABLE ledger_bill_legacy RENAME TO ledger_bill`);
        }
        const cols = await db.execute(`PRAGMA table_info(ledger_bill)`);
        const exists = cols.rows.length > 0;
        const hasWorkspace = cols.rows.some((r) => String((r as Record<string, unknown>).name) === "workspace_id");
        if (exists && !hasWorkspace) {
          await db.batch([
            `ALTER TABLE ledger_bill RENAME TO ledger_bill_legacy`,
            DDL,
            `INSERT INTO ledger_bill (bill_no, workspace_id, invoice_id, vendor, doc_number, amount, currency, entered_at)
             SELECT bill_no, '${DEFAULT_WORKSPACE}', invoice_id, vendor, doc_number, amount, currency, entered_at FROM ledger_bill_legacy`,
            `DROP TABLE ledger_bill_legacy`,
          ], "write");
        } else {
          await db.execute(DDL);
        }
      } catch (e) {
        ensured = null;
        throw e;
      }
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
  workspaceId?: string;
}

export interface LedgerBill {
  billNumber: string;
  invoiceId: string;
  vendor: string;
  docNumber: string;
  amount: number;
  currency: string;
  enteredAt: number;
}

const billNumber = (no: number) => `AEM-${no}`;

/** Record (or return the existing) ledger bill for an invoice in a workspace. Idempotent. */
export async function recordLedgerBill(input: LedgerBillInput): Promise<{ billNumber: string }> {
  await ensureLedgerSchema();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE;
  const ins = await db.execute({
    sql: `INSERT OR IGNORE INTO ledger_bill (workspace_id, invoice_id, vendor, doc_number, amount, currency, entered_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [workspaceId, input.invoiceId, input.vendor, input.docNumber, input.amount, input.currency, input.now],
  });
  if (ins.rowsAffected === 1) return { billNumber: billNumber(Number(ins.lastInsertRowid)) };
  const r = await db.execute({
    sql: `SELECT bill_no FROM ledger_bill WHERE workspace_id = ? AND invoice_id = ?`,
    args: [workspaceId, input.invoiceId],
  });
  return { billNumber: billNumber(Number(r.rows[0].bill_no)) };
}

/**
 * Remove a workspace's ledger bill for an invoice. Used to roll back a bill that
 * was written just before its `invoice.submitted` seal lost the sequence slot to
 * a concurrent terminal event (e.g. a reject) - otherwise the ledger would hold a
 * bill for an invoice the sealed audit stream says was never submitted.
 */
export async function deleteLedgerBill(
  invoiceId: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<void> {
  await ensureLedgerSchema();
  await db.execute({
    sql: `DELETE FROM ledger_bill WHERE workspace_id = ? AND invoice_id = ?`,
    args: [workspaceId, invoiceId],
  });
}

/** Count and total value of a workspace's ledger bills. */
export async function ledgerStats(workspaceId: string = DEFAULT_WORKSPACE): Promise<{ count: number; total: number }> {
  await ensureLedgerSchema();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS t FROM ledger_bill WHERE workspace_id = ?`,
    args: [workspaceId],
  });
  const row = r.rows[0] as Record<string, unknown>;
  return { count: Number(row.c), total: Number(row.t) };
}

/** Recent ledger bills for a workspace, newest first. */
export async function listLedgerBills(limit = 50, workspaceId: string = DEFAULT_WORKSPACE): Promise<LedgerBill[]> {
  await ensureLedgerSchema();
  const r = await db.execute({
    sql: `SELECT * FROM ledger_bill WHERE workspace_id = ? ORDER BY bill_no DESC LIMIT ?`,
    args: [workspaceId, limit],
  });
  return r.rows.map((row) => ({
    billNumber: billNumber(Number(row.bill_no)),
    invoiceId: String(row.invoice_id),
    vendor: String(row.vendor),
    docNumber: String(row.doc_number),
    amount: Number(row.amount),
    currency: String(row.currency),
    enteredAt: Number(row.entered_at),
  }));
}
