import { afterEach, describe, expect, it } from "vitest";
import { agentFallbackEnabled } from "../lib/agent";

const orig = process.env.AEMULUS_AGENT_FALLBACK;
afterEach(() => {
  if (orig === undefined) delete process.env.AEMULUS_AGENT_FALLBACK;
  else process.env.AEMULUS_AGENT_FALLBACK = orig;
});

describe("agentic fallback gate", () => {
  it("is OFF by default and ON only when explicitly enabled", () => {
    delete process.env.AEMULUS_AGENT_FALLBACK;
    expect(agentFallbackEnabled()).toBe(false);
    process.env.AEMULUS_AGENT_FALLBACK = "0";
    expect(agentFallbackEnabled()).toBe(false);
    process.env.AEMULUS_AGENT_FALLBACK = "1";
    expect(agentFallbackEnabled()).toBe(true);
  });
});
