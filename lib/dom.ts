import type { Page } from "playwright";
import type { Candidate } from "./operate";

/**
 * Collect the page's interactive elements for the operator / agent to choose
 * from. Shared by the runner and the agentic fallback. Capped so the prompt
 * stays small.
 *
 * Each candidate carries a selector that is verified UNIQUE on the page, so the
 * operator's choice resolves to the exact element it saw (a bare `button`/`a`
 * would match the first such node and, worse, get learned back into the skill as
 * a fragile selector). We prefer stable identity - id, data-testid, name,
 * aria-label - and only fall back to a structural `:nth-of-type` path when none
 * of those uniquely identify the element. The accessibility `role` is included
 * too, since it survives visual redesigns better than tag/class (the insight
 * behind accessibility-tree-based automation).
 */
export function collectCandidates(page: Page): Promise<Candidate[]> {
  return page.evaluate(() => {
    const esc = (s: string) =>
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(s)
        : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    // Escape a value for use inside an [attr="..."] selector.
    const attrVal = (v: string) => v.replace(/["\\]/g, "\\$&");
    const unique = (s: string): boolean => {
      try {
        return document.querySelectorAll(s).length === 1;
      } catch {
        return false;
      }
    };

    const idSelector = (el: Element): string | null => {
      const id = el.getAttribute("id");
      if (id && unique(`#${esc(id)}`)) return `#${esc(id)}`;
      return null;
    };

    // A selector that uniquely identifies `el`, preferring stable identity and
    // only using a structural path as a last resort.
    const uniqueSelector = (el: Element): string => {
      const idSel = idSelector(el);
      if (idSel) return idSel;

      const tag = el.tagName.toLowerCase();
      // Try single stable attributes, most-durable first.
      for (const attr of ["data-testid", "data-test", "name", "aria-label", "placeholder"]) {
        const v = el.getAttribute(attr);
        if (v) {
          const s = `${tag}[${attr}="${attrVal(v)}"]`;
          if (unique(s)) return s;
        }
      }

      // Structural path with :nth-of-type, stopping as soon as it's unique or we
      // reach a uniquely-id'd ancestor.
      const parts: string[] = [];
      let node: Element | null = el;
      let depth = 0;
      while (node && node.nodeType === 1 && node !== document.documentElement && depth < 8) {
        const anchor = idSelector(node);
        if (anchor) {
          parts.unshift(anchor);
          break;
        }
        let seg = node.tagName.toLowerCase();
        const parent: Element | null = node.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter(
            (c) => c.tagName === node!.tagName,
          );
          if (sameTag.length > 1) seg += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
        }
        parts.unshift(seg);
        const path = parts.join(" > ");
        if (unique(path)) return path;
        node = parent;
        depth++;
      }
      return parts.join(" > ");
    };

    // Implicit ARIA role for the common interactive tags, else the explicit one.
    const roleOf = (el: Element): string => {
      const explicit = el.getAttribute("role");
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === "a") return el.hasAttribute("href") ? "link" : "";
      if (tag === "button") return "button";
      if (tag === "select") return "combobox";
      if (tag === "textarea") return "textbox";
      if (tag === "input") {
        const t = (el.getAttribute("type") || "text").toLowerCase();
        if (t === "checkbox") return "checkbox";
        if (t === "radio") return "radio";
        if (t === "button" || t === "submit" || t === "reset") return "button";
        return "textbox";
      }
      return "";
    };

    const nodes = Array.from(
      document.querySelectorAll(
        "a, button, input, select, textarea, [role='button'], [onclick]",
      ),
    ).slice(0, 50);

    return nodes.map((el) => ({
      selector: uniqueSelector(el),
      tag: el.tagName.toLowerCase(),
      role: roleOf(el),
      name:
        el.getAttribute("aria-label") ||
        el.getAttribute("name") ||
        el.getAttribute("placeholder") ||
        "",
      text: ((el as HTMLElement).innerText || "").trim().slice(0, 60),
    }));
  });
}
