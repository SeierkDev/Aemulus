import { appendApEvent } from "./store";
import { enterInvoice } from "./qbo-submit";
import { id as newId } from "../ids";
import { logError, logInfo } from "../log";

// Optional workspace-activity generator. When AEMULUS_AP_ACTIVITY=1, it runs a
// realistic invoice through the REAL pipeline on an interval: clean ones are
// auto-entered into the ledger (sealed), flagged ones land in the review queue.
// Every record it produces is a genuine, verifiable sealed entry — the inputs
// are seeded, nothing in the feed is fabricated. Off by default.

export function apActivityEnabled(): boolean {
  return process.env.AEMULUS_AP_ACTIVITY === "1";
}

const SYSTEM = { userId: "system", role: "system" };

interface Sample {
  vendor: string;
  amount: number;
  flag?: { reason: string; banner: string };
}

const POOL: Sample[] = [
  { vendor: "Northwind Traders", amount: 412.5 },
  { vendor: "Contoso Ltd", amount: 1290.0 },
  { vendor: "Fabrikam Inc", amount: 88.75, flag: { reason: "NEW_VENDOR", banner: "Held for review: the vendor isn’t on file." } },
  { vendor: "Wide World Importers", amount: 233.19 },
  { vendor: "Tailspin Toys", amount: 5400.0, flag: { reason: "OVER_CEILING", banner: "Held for review: the amount is over the auto-entry limit." } },
  { vendor: "Adventure Works", amount: 1842.0, flag: { reason: "DUPLICATE", banner: "Held for review: it looks like a duplicate." } },
];

let seq = 0;

/** Run one activity step: auto-enter a clean invoice, or flag one for review. */
export async function runApActivityTick(now: number): Promise<void> {
  const sample = POOL[seq % POOL.length];
  seq += 1;
  const invoiceId = `ap_act_${now}_${seq}`;
  const docNumber = `INV-${1000 + seq}`;
  try {
    if (sample.flag) {
      await appendApEvent({
        aggregateType: "invoice",
        aggregateId: invoiceId,
        eventType: "invoice.review_paused",
        payload: {
          reasonCodes: [sample.flag.reason],
          topReasonCode: sample.flag.reason,
          banner: sample.flag.banner,
          amount: sample.amount,
          currency: "USD",
          vendor: sample.vendor,
          requiresSecondApproval: false,
        },
        actor: SYSTEM,
        now,
        id: newId("evt"),
      });
    } else {
      await enterInvoice({
        invoiceId,
        vendorName: sample.vendor,
        docNumber,
        txnDate: new Date(now).toISOString().slice(0, 10),
        amount: sample.amount,
        total: sample.amount,
        currency: "USD",
        actor: SYSTEM,
        auto: true,
        now,
      });
    }
  } catch (e) {
    logError("ap.activity.tick", e);
  }
}

declare global {
  var __aemApActivity: ReturnType<typeof setInterval> | undefined;
}

export function startApActivity(): void {
  if (!apActivityEnabled() || globalThis.__aemApActivity) return;
  const ms = Math.max(5_000, Number(process.env.AEMULUS_AP_ACTIVITY_MS) || 60_000);
  globalThis.__aemApActivity = setInterval(() => void runApActivityTick(Date.now()), ms);
  logInfo("ap.activity", `started (${ms}ms tick)`);
}
