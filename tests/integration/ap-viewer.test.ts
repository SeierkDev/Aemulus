import { describe, it, expect } from "vitest";
import { viewerEntitlement, type ApViewer } from "../../lib/ap-controls/ap-viewer";
import { freeEntryLimit } from "../../lib/ap-controls/billing";

const NOW = 1_700_000_000_000;

describe("viewer entitlement ($AEMU tier)", () => {
  it("Pro/Whale (level ≥ 2) is unlimited; Holder (level 1) is capped at the free limit", async () => {
    const whale: ApViewer = { workspaceId: "w_whale", name: "w", pubkey: "w", tier: "Whale", level: 3 };
    const holder: ApViewer = { workspaceId: "w_holder", name: "h", pubkey: "h", tier: "Holder", level: 1 };
    expect((await viewerEntitlement(whale, NOW)).limit).toBeNull();
    expect((await viewerEntitlement(holder, NOW)).limit).toBe(freeEntryLimit());
  });
});
