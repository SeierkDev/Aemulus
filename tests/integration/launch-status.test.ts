import { afterEach, describe, expect, it } from "vitest";
import { launchStatus, launchStatusLine } from "../../lib/launch-status";

const KEYS = ["AEMULUS_MINT", "AEMULUS_REQUIRE_GATING", "AEMULUS_RECEIPT_SECRET", "AEMULUS_REGISTRY_PROGRAM", "AEMULUS_TREASURY_SECRET"];
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("launchStatus", () => {
  it("reports everything off in the pre-launch (unconfigured) state", () => {
    for (const k of KEYS) delete process.env[k];
    const s = launchStatus();
    expect(s).toMatchObject({
      gating: false,
      requireGating: false,
      memoAnchor: false,
      registryAnchor: false,
      zkAnchor: false,
      payouts: false,
      reconciler: false, // no anchor path → reconciler inert
    });
    expect(launchStatusLine()).toContain("gating=off (pre-launch)");
  });

  it("reflects a configured Memo anchor (reconciler becomes live)", () => {
    delete process.env.AEMULUS_MINT;
    process.env.AEMULUS_RECEIPT_SECRET = "sig";
    const s = launchStatus();
    expect(s.memoAnchor).toBe(true);
    expect(s.reconciler).toBe(true);
    expect(launchStatusLine()).toContain("memo=on");
  });

  it("surfaces the fail-closed launch flag", () => {
    process.env.AEMULUS_REQUIRE_GATING = "1";
    expect(launchStatus().requireGating).toBe(true);
  });
});
