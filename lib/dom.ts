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

      // Structural path with :nth-of-type, walking up until the path is unique
      // or we anchor at a uniquely-id'd ancestor / <body>. A complete nth-of-type
      // path down from <body> is always unique, so we must keep walking (not stop
      // at an arbitrary shallow depth, which could return an ambiguous selector);
      // the cap is only a runaway guard for pathologically deep DOMs.
      const parts: string[] = [];
      let node: Element | null = el;
      let depth = 0;
      while (node && node.nodeType === 1 && node !== document.documentElement && depth < 40) {
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

    // Every field below is UNTRUSTED page content that gets rendered into the
    // operator/agent model prompt between AEMULUS_*_BEGIN/END fence markers. Strip
    // control chars (so a value can't inject a newline + a fake instruction), NEUTER
    // any forged fence marker, and hard-cap length (so a giant aria-label can't blow
    // the token budget). operate.ts/agent.ts rely on this fence holding.
    const clean = (s: string, max: number): string =>
      (s || "")
        .replace(/[\u0000-\u001f]+/g, " ")
        .replace(/AEMULUS_[A-Z_]+/g, "·")
        .trim()
        .slice(0, max);

    // The selector must stay VERBATIM — it's used to LOCATE the element, so truncating
    // a verified-unique path could make it match an ancestor (mis-target a click/type)
    // or nothing (break a step that used to work). Only strip control chars; drop a
    // candidate whose selector is implausibly long rather than emit a broken one.
    const stripCtl = (s: string): string => (s || "").replace(/[\u0000-\u001f]+/g, "");
    return nodes
      .map((el) => ({
        selector: stripCtl(uniqueSelector(el)),
        tag: el.tagName.toLowerCase(),
        role: roleOf(el),
        name: clean(
          el.getAttribute("aria-label") ||
            el.getAttribute("name") ||
            el.getAttribute("placeholder") ||
            "",
          80,
        ),
        text: clean((el as HTMLElement).innerText || "", 60),
      }))
      .filter((c) => c.selector.length > 0 && c.selector.length <= 512);
  });
}
