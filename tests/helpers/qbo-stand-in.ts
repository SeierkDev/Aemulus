import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// An in-memory QuickBooks Online API for tests. It implements the exact subset
// the client uses (companyinfo, query for Vendor/Account/Bill, create Bill) with
// the same request/response shapes AND the same validation the real API enforces
// — auth required, and a Bill needs a known VendorRef plus a line with an
// AccountRef and a numeric Amount — so the client test actually exercises the
// contract, not a rubber stamp.

interface Vendor { Id: string; DisplayName: string }
interface Account { Id: string; Name: string; AccountType: string }
interface StoredBill { Id: string; DocNumber?: string; TotalAmt: number }

interface IncomingBill {
  VendorRef?: { value?: string };
  DocNumber?: string;
  Line?: { Amount?: number; AccountBasedExpenseLineDetail?: { AccountRef?: { value?: string } } }[];
}

export interface QboStandIn {
  url: string;
  realm: string;
  bills: () => StoredBill[];
  close: () => Promise<void>;
}

const fault = (message: string, type = "ValidationFault") => ({
  Fault: { Error: [{ Message: message }], type },
});

export async function startQboStandIn(): Promise<QboStandIn> {
  const realm = "test-realm";
  const vendors: Vendor[] = [{ Id: "1", DisplayName: "Acme Corp" }];
  const accounts: Account[] = [{ Id: "60", Name: "Office Supplies", AccountType: "Expense" }];
  const bills: StoredBill[] = [];
  let nextId = 100;

  const server: Server = createServer((req, res) => {
    const send = (code: number, obj: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    const auth = req.headers.authorization ?? "";
    if (!/^Bearer .+/.test(auth) || auth === "Bearer expired") {
      return send(401, fault("Message=Token expired", "AUTHENTICATION"));
    }

    const url = new URL(req.url ?? "", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && /\/companyinfo\//.test(path)) {
      return send(200, { CompanyInfo: { CompanyName: "Sandbox Company_US_1" } });
    }

    if (req.method === "GET" && path.endsWith("/query")) {
      const q = url.searchParams.get("query") ?? "";
      if (/from Vendor/i.test(q)) {
        const name = q.match(/DisplayName\s*=\s*'([^']*)'/i)?.[1];
        const found = name ? vendors.filter((v) => v.DisplayName === name) : vendors;
        return send(200, { QueryResponse: found.length ? { Vendor: found } : {} });
      }
      if (/from Account/i.test(q)) {
        return send(200, { QueryResponse: { Account: accounts } });
      }
      if (/from Bill/i.test(q)) {
        const doc = q.match(/DocNumber\s*=\s*'([^']*)'/i)?.[1];
        const found = bills.filter((b) => b.DocNumber === doc);
        return send(200, { QueryResponse: found.length ? { Bill: found } : {} });
      }
      return send(200, { QueryResponse: {} });
    }

    if (req.method === "POST" && path.endsWith("/bill")) {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        let body: IncomingBill;
        try {
          body = JSON.parse(raw) as IncomingBill;
        } catch {
          return send(400, fault("Invalid JSON"));
        }
        const vendorId = body.VendorRef?.value;
        if (!vendorId || !vendors.some((v) => v.Id === vendorId)) {
          return send(400, fault("Invalid Reference Id: VendorRef", "ValidationFault"));
        }
        const line = body.Line?.[0];
        const accountId = line?.AccountBasedExpenseLineDetail?.AccountRef?.value;
        if (!accountId || typeof line?.Amount !== "number") {
          return send(400, fault("Invalid line: AccountRef/Amount required"));
        }
        const total = (body.Line ?? []).reduce((s, l) => s + (l.Amount ?? 0), 0);
        const bill: StoredBill = { Id: String(nextId++), DocNumber: body.DocNumber, TotalAmt: total };
        bills.push(bill);
        return send(200, { Bill: bill });
      });
      return;
    }

    return send(404, fault("Not found", "SystemFault"));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    realm,
    bills: () => bills,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
