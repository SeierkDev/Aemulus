import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createSkill, setPublished, searchPublishedSkills } from "../../lib/skills";
import type { GeneralizedSkill } from "../../lib/types";

const OWNER = "WALLET_SEARCH";
function gen(name: string, description: string): GeneralizedSkill {
  // Include a runnable step so the skill is publishable (empty plans are refused).
  return {
    name,
    description,
    inputFields: [],
    steps: [{ intent: "open", action: "navigate", selectors: [], target: "data:text/html,<p>x</p>", valueSource: "none", value: "", inputKey: "", key: "" }],
  };
}
async function publish(name: string, description: string) {
  const s = await createSkill({ owner: OWNER, generalized: gen(name, description), sourceDemoId: null });
  await setPublished(s.id, OWNER, true);
  return s;
}

beforeAll(async () => {
  await ready();
});

describe("searchPublishedSkills", () => {
  it("matches name or description, published only, and escapes LIKE wildcards", async () => {
    const inv = await publish("Invoice exporter", "Pull invoices from QuickBooks");
    const px = await publish("Pixel scraper", "Grab 100% of the data");
    const draft = await createSkill({ owner: OWNER, generalized: gen("Invoice draft", "unpublished"), sourceDemoId: null });

    // name match
    let ids = (await searchPublishedSkills("invoice")).map((s) => s.id);
    expect(ids).toContain(inv.id);
    expect(ids).not.toContain(px.id);
    expect(ids).not.toContain(draft.id); // unpublished excluded

    // description match
    ids = (await searchPublishedSkills("quickbooks")).map((s) => s.id);
    expect(ids).toContain(inv.id);

    // a literal "%" must NOT act as a wildcard (would otherwise match everything)
    ids = (await searchPublishedSkills("%")).map((s) => s.id);
    expect(ids).toContain(px.id); // px's description literally contains "%"
    expect(ids).not.toContain(inv.id); // no "%" in invoice skill

    // empty query falls back to the default list (top published)
    expect((await searchPublishedSkills("   ")).length).toBeGreaterThan(0);
  });
});
