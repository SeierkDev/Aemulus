import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import {
  creditEarning,
  getClaimable,
  claimEarnings,
} from "../../lib/earnings";

const OWNER = "WALLET_CLAIM";
// stub on-chain sender — exercises the bookkeeping without a real transfer
const okSend = async () => ({ sig: "sig_test", cluster: "devnet" });
const failSend = async () => {
  throw new Error("rpc down");
};

beforeAll(async () => {
  await ready();
});

describe("claimEarnings", () => {
  it("settles unclaimed earnings exactly once and is idempotent", async () => {
    await creditEarning({ owner: OWNER, skillId: "a", runId: "c1", runner: "X", amount: 10 });
    await creditEarning({ owner: OWNER, skillId: "a", runId: "c2", runner: "X", amount: 15 });
    expect(await getClaimable(OWNER)).toBe(25);

    const res = await claimEarnings(OWNER, okSend);
    expect(res.claimed).toBe(25);
    expect(res.sig).toBe("sig_test");
    expect(await getClaimable(OWNER)).toBe(0);

    // second claim → nothing left
    expect((await claimEarnings(OWNER, okSend)).claimed).toBe(0);
  });

  it("only claims pre-existing earnings; later credits stay claimable", async () => {
    const O = "WALLET_CLAIM_2";
    await creditEarning({ owner: O, skillId: "a", runId: "d1", runner: "X", amount: 10 });
    await claimEarnings(O, okSend);
    await creditEarning({ owner: O, skillId: "a", runId: "d2", runner: "X", amount: 7 });
    expect(await getClaimable(O)).toBe(7);
  });

  it("rolls back (no funds marked claimed) when the payout fails", async () => {
    const O = "WALLET_CLAIM_3";
    await creditEarning({ owner: O, skillId: "a", runId: "e1", runner: "X", amount: 12 });
    await expect(claimEarnings(O, failSend)).rejects.toThrow();
    // still fully claimable after the failed attempt
    expect(await getClaimable(O)).toBe(12);
    // and a retry succeeds
    expect((await claimEarnings(O, okSend)).claimed).toBe(12);
  });
});
