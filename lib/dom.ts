import type { Page } from "playwright";
import type { Candidate } from "./operate";

/**
 * Collect the page's interactive elements (with a best-effort stable selector)
 * for the operator / agent to choose from. Shared by the runner and the agentic
 * fallback. Capped so the prompt stays small.
 */
export function collectCandidates(page: Page): Promise<Candidate[]> {
  return page.evaluate(() => {
    const esc = (s: string) =>
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(s)
        : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const sel = (el: Element): string => {
      const id = el.getAttribute("id");
      if (id) return `#${esc(id)}`;
      const tag = el.tagName.toLowerCase();
      const name = el.getAttribute("name");
      if (name) return `${tag}[name="${name}"]`;
      const aria = el.getAttribute("aria-label");
      if (aria) return `${tag}[aria-label="${aria}"]`;
      return tag;
    };
    const nodes = Array.from(
      document.querySelectorAll(
        "a, button, input, select, textarea, [role='button'], [onclick]",
      ),
    ).slice(0, 50);
    return nodes.map((el) => ({
      selector: sel(el),
      tag: el.tagName.toLowerCase(),
      name:
        el.getAttribute("aria-label") ||
        el.getAttribute("name") ||
        el.getAttribute("placeholder") ||
        "",
      text: ((el as HTMLElement).innerText || "").trim().slice(0, 60),
    }));
  });
}
