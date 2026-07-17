import { db, ready } from "../db";
import { qboClient, QboError, type QboConfig } from "./client";
import { DEFAULT_WORKSPACE } from "../ap-controls/workspace";

// Idempotent invoice → QuickBooks Bill write, scoped per workspace.
//
// The (workspace_id, invoice_id) key on qbo_write is the double-post guard: only
// the caller that successfully claims the row writes to QBO. Concurrent duplicates
// return the posted bill or 'in_progress'; a crashed 'pending' claim is recovered
// by reconciling against QBO (findBillByDocNumber) and, past a staleness window,
// reclaimed. We also reconcile immediately before every create, so a bill is
// never posted twice for the same document number.

const STALE_MS = 60_000; // a 'pending' claim older than this is treated as crashed

const DDL = `
  CREATE TABLE IF NOT EXISTS qbo_write (
    workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE}',
    invoice_id   TEXT NOT NULL,
    status       TEXT NOT NULL,            -- 'pending' | 'posted' | 'failed'
    qbo_bill_id  TEXT,
    doc_number   TEXT NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, invoice_id)
  )`;

let ensured: Promise<void> | null = null;
export function ensureQboSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      try {
        await ready();
        const legacy = await db.execute(`PRAGMA table_info(qbo_write_legacy)`);
        const mainPre = await db.execute(`PRAGMA table_info(qbo_write)`);
        if (legacy.rows.length > 0 && mainPre.rows.length === 0) {
          await db.execute(`ALTER TABLE qbo_write_legacy RENAME TO qbo_write`);
        }
        const cols = await db.execute(`PRAGMA table_info(qbo_write)`);
        const exists = cols.rows.length > 0;
        const hasWorkspace = cols.rows.some((r) => String((r as Record<string, unknown>).name) === "workspace_id");
        if (exists && !hasWorkspace) {
          await db.batch([
            `ALTER TABLE qbo_write RENAME TO qbo_write_legacy`,
            DDL,
            `INSERT INTO qbo_write (workspace_id, invoice_id, status, qbo_bill_id, doc_number, attempts, last_error, created_at, updated_at)
             SELECT '${DEFAULT_WORKSPACE}', invoice_id, status, qbo_bill_id, doc_number, attempts, last_error, created_at, updated_at FROM qbo_write_legacy`,
            `DROP TABLE qbo_write_legacy`,
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

export type WriteResult =
  | { status: "posted"; billId: string; alreadyPosted?: boolean }
  | { status: "in_progress" }
  | { status: "failed"; error: string };

export interface QboWriteRow {
  invoiceId: string;
  status: "pending" | "posted" | "failed";
  qboBillId: string | null;
  docNumber: string;
  attempts: number;
  lastError: string | null;
}

export interface WriteInvoiceInput {
  invoiceId: string;
  vendorName: string;
  docNumber: string;
  txnDate: string; // YYYY-MM-DD
  amount: number;
  config: QboConfig;
  now: number;
  workspaceId?: string;
}

export async function readQboWrite(invoiceId: string, workspaceId: string = DEFAULT_WORKSPACE): Promise<QboWriteRow | null> {
  await ensureQboSchema();
  const r = await db.execute({ sql: `SELECT * FROM qbo_write WHERE workspace_id = ? AND invoice_id = ?`, args: [workspaceId, invoiceId] });
  const row = r.rows[0];
  if (!row) return null;
  return {
    invoiceId: String(row.invoice_id),
    status: String(row.status) as QboWriteRow["status"],
    qboBillId: row.qbo_bill_id == null ? null : String(row.qbo_bill_id),
    docNumber: String(row.doc_number),
    attempts: Number(row.attempts),
    lastError: row.last_error == null ? null : String(row.last_error),
  };
}

async function setPosted(workspaceId: string, invoiceId: string, billId: string, now: number) {
  await db.execute({
    sql: `UPDATE qbo_write SET status='posted', qbo_bill_id=?, last_error=NULL, updated_at=? WHERE workspace_id=? AND invoice_id=?`,
    args: [billId, now, workspaceId, invoiceId],
  });
}
async function setFailed(workspaceId: string, invoiceId: string, error: string, now: number) {
  await db.execute({
    sql: `UPDATE qbo_write SET status='failed', last_error=?, updated_at=? WHERE workspace_id=? AND invoice_id=?`,
    args: [error.slice(0, 500), now, workspaceId, invoiceId],
  });
}

/**
 * Post one invoice as a QBO Bill, exactly once. Never throws — returns a typed
 * result so callers can fire-and-forget.
 */
export async function writeInvoiceToQbo(input: WriteInvoiceInput): Promise<WriteResult> {
  await ensureQboSchema();
  const { invoiceId, docNumber, now } = input;
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE;
  const client = qboClient(input.config);

  // Claim the write. Only the inserter (or a legitimate reclaimer) proceeds.
  const claim = await db.execute({
    sql: `INSERT OR IGNORE INTO qbo_write (workspace_id, invoice_id, status, doc_number, attempts, created_at, updated_at)
          VALUES (?, ?, 'pending', ?, 1, ?, ?)`,
    args: [workspaceId, invoiceId, docNumber, now, now],
  });
  let owned = claim.rowsAffected === 1;

  if (!owned) {
    const row = await readQboWrite(invoiceId, workspaceId);
    if (!row) return { status: "in_progress" };
    if (row.status === "posted" && row.qboBillId) {
      return { status: "posted", billId: row.qboBillId, alreadyPosted: true };
    }
    // Reconcile: a prior attempt may already have created the bill.
    const existing = await client.findBillByDocNumber(docNumber).catch(() => null);
    if (existing?.Id) {
      await setPosted(workspaceId, invoiceId, existing.Id, now);
      return { status: "posted", billId: existing.Id };
    }
    if (row.status === "failed") {
      const r = await db.execute({
        sql: `UPDATE qbo_write SET status='pending', attempts=attempts+1, last_error=NULL, updated_at=? WHERE workspace_id=? AND invoice_id=? AND status='failed'`,
        args: [now, workspaceId, invoiceId],
      });
      owned = r.rowsAffected === 1;
    } else {
      // pending — reclaim only if the claim is stale (crashed), else back off.
      if (now - (await staleUpdatedAt(workspaceId, invoiceId)) > STALE_MS) {
        const r = await db.execute({
          sql: `UPDATE qbo_write SET attempts=attempts+1, updated_at=? WHERE workspace_id=? AND invoice_id=? AND status='pending' AND updated_at < ?`,
          args: [now, workspaceId, invoiceId, now - STALE_MS],
        });
        owned = r.rowsAffected === 1;
      }
    }
    if (!owned) return { status: "in_progress" };
  }

  // We own the write.
  try {
    // Belt-and-suspenders: never create a second bill for the same document.
    const pre = await client.findBillByDocNumber(docNumber);
    if (pre?.Id) {
      await setPosted(workspaceId, invoiceId, pre.Id, now);
      return { status: "posted", billId: pre.Id };
    }
    const vendor = await client.findVendorByName(input.vendorName);
    if (!vendor) {
      await setFailed(workspaceId, invoiceId, "vendor_not_found", now);
      return { status: "failed", error: "vendor_not_found" };
    }
    const account = await client.findExpenseAccount();
    if (!account) {
      await setFailed(workspaceId, invoiceId, "no_expense_account", now);
      return { status: "failed", error: "no_expense_account" };
    }
    const bill = await client.createBill({
      vendorId: vendor.Id,
      accountId: account.Id,
      docNumber,
      txnDate: input.txnDate,
      amount: input.amount,
    });
    await setPosted(workspaceId, invoiceId, bill.Id, now);
    return { status: "posted", billId: bill.Id };
  } catch (e) {
    const msg = e instanceof QboError ? `qbo_${e.status}: ${e.message}` : e instanceof Error ? e.message : "write_failed";
    await setFailed(workspaceId, invoiceId, msg, now);
    return { status: "failed", error: msg };
  }
}

async function staleUpdatedAt(workspaceId: string, invoiceId: string): Promise<number> {
  const r = await db.execute({ sql: `SELECT updated_at FROM qbo_write WHERE workspace_id = ? AND invoice_id = ?`, args: [workspaceId, invoiceId] });
  return r.rows[0] ? Number(r.rows[0].updated_at) : 0;
}
