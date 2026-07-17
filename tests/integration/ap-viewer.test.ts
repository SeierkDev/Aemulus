import { describe, it, expect } from "vitest";
import { viewerEntitlement, type ApViewer } from "../../lib/ap-controls/ap-viewer";
import { freeEntryLimit, setPlan } from "../../lib/ap-controls/billing";

const NOW = 1_700_000_000_000;

describe("viewer entitlement", () => {
  it("wallet Pro/Whale (level ≥ 2) is unlimited; Holder (level 1) is capped at the free limit", async () => {
    const whale: ApViewer = { kind: "wallet", workspaceId: "w_whale", name: "w", pubkey: "w", tier: "Whale", level: 3 };
    const holder: ApViewer = { kind: "wallet", workspaceId: "w_holder", name: "h", pubkey: "h", tier: "Holder", level: 1 };
    expect((await viewerEntitlement(whale, NOW)).limit).toBeNull();
    expect((await viewerEntitlement(holder, NOW)).limit).toBe(freeEntryLimit());
  });

  it("email viewer delegates to the Stripe plan (pro → unlimited)", async () => {
    const ws = "usr_viewer1";
    await setPlan({ workspaceId: ws, plan: "pro", status: "active", now: NOW });
    const email: ApViewer = { kind: "email", workspaceId: ws, name: "e", email: "e@x.co" };
    expect((await viewerEntitlement(email, NOW)).limit).toBeNull();
  });
});
