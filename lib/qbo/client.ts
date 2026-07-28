// QuickBooks Online API client. Talks to whatever base URL it's configured with
// (the QBO sandbox, production, or a local stand-in in tests). Implements only
// the surface the invoice write path needs: resolve a vendor, resolve an expense
// account, create a Bill, and look a Bill up by document number.

export interface QboConfig {
  /** API base, e.g. https://sandbox-quickbooks.api.intuit.com */
  base: string;
  /** QBO company id (realmId). */
  realm: string;
  /** Bearer access token. */
  token: string;
  minorVersion?: string;
}

export interface QboVendor {
  Id: string;
  DisplayName: string;
}
export interface QboAccount {
  Id: string;
  Name: string;
  AccountType?: string;
}
export interface QboBill {
  Id: string;
  DocNumber?: string;
  TotalAmt?: number;
  CurrencyRef?: { value?: string };
}

export class QboError extends Error {
  status: number;
  fault?: unknown;
  constructor(status: number, message: string, fault?: unknown) {
    super(message);
    this.name = "QboError";
    this.status = status;
    this.fault = fault;
  }
}

export interface CreateBillInput {
  vendorId: string;
  accountId: string;
  docNumber: string;
  /** YYYY-MM-DD */
  txnDate: string;
  amount: number;
  /** ISO-4217 code; sets the Bill's CurrencyRef so a foreign invoice isn't
   *  silently booked in the company's home currency. */
  currency?: string;
}

const esc = (s: string) => s.replace(/'/g, "''");
// Bound every Intuit call so a hung endpoint can't pin the request/worker (and
// so a slow-but-alive owner can't overrun the stale-reclaim window → double-post).
const QBO_TIMEOUT_MS = 15_000;

export function qboClient(cfg: QboConfig) {
  const mv = cfg.minorVersion ?? "73";
  const base = cfg.base.replace(/\/+$/, "");
  // Encode the realm (company id) into the URL path — it comes from the OAuth
  // callback query, so don't interpolate it raw.
  const realm = encodeURIComponent(cfg.realm);
  const authHeaders = () => ({
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  });

  async function query<T>(sql: string, entity: string): Promise<T[]> {
    const u = new URL(`${base}/v3/company/${realm}/query`);
    u.searchParams.set("query", sql);
    u.searchParams.set("minorversion", mv);
    const r = await fetch(u, { headers: authHeaders(), signal: AbortSignal.timeout(QBO_TIMEOUT_MS) });
    if (r.status === 401) throw new QboError(401, "QuickBooks authorization failed");
    if (!r.ok) throw new QboError(r.status, `QuickBooks query failed (${r.status})`);
    const j = (await r.json().catch(() => ({}))) as {
      QueryResponse?: Record<string, unknown>;
    };
    const rows = j.QueryResponse?.[entity];
    return Array.isArray(rows) ? (rows as T[]) : [];
  }

  return {
    async findVendorByName(name: string): Promise<QboVendor | null> {
      const rows = await query<QboVendor>(
        `select * from Vendor where DisplayName = '${esc(name)}'`,
        "Vendor",
      );
      return rows[0] ?? null;
    },

    async findExpenseAccount(): Promise<QboAccount | null> {
      const rows = await query<QboAccount>(
        `select Id, Name, AccountType from Account where AccountType = 'Expense'`,
        "Account",
      );
      return rows[0] ?? null;
    },

    async findBillByDocNumber(docNumber: string): Promise<QboBill | null> {
      const rows = await query<QboBill>(
        `select * from Bill where DocNumber = '${esc(docNumber)}'`,
        "Bill",
      );
      return rows[0] ?? null;
    },

    async createBill(input: CreateBillInput): Promise<QboBill> {
      const body: Record<string, unknown> = {
        VendorRef: { value: input.vendorId },
        TxnDate: input.txnDate,
        DocNumber: input.docNumber,
        Line: [
          {
            DetailType: "AccountBasedExpenseLineDetail",
            Amount: Math.round(input.amount * 100) / 100, // round to currency precision
            AccountBasedExpenseLineDetail: { AccountRef: { value: input.accountId } },
          },
        ],
      };
      // Book in the invoice's currency, not the company home currency, when given
      // a valid ISO-4217 code (requires multicurrency enabled in the QBO company).
      if (input.currency && /^[A-Za-z]{3}$/.test(input.currency)) {
        body.CurrencyRef = { value: input.currency.toUpperCase() };
      }
      const r = await fetch(`${base}/v3/company/${realm}/bill?minorversion=${mv}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(QBO_TIMEOUT_MS),
      });
      const j = (await r.json().catch(() => ({}))) as { Bill?: QboBill };
      if (r.status === 401) throw new QboError(401, "QuickBooks authorization failed", j);
      if (!r.ok || !j.Bill?.Id) {
        throw new QboError(r.status, "QuickBooks rejected the bill", j);
      }
      return j.Bill;
    },
  };
}

export type QboClient = ReturnType<typeof qboClient>;
