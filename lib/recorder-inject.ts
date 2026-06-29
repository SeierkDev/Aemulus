/**
 * In-page recorder script. Injected into every top frame via Playwright's
 * addInitScript, so it MUST be fully self-contained — it may not reference
 * anything outside its own body (it gets serialized and runs in the browser).
 *
 * It reports each meaningful user interaction to window.__aemRecord, which
 * Playwright bridges back to the Node recorder.
 */
export function recorderInitScript() {
  // Run once, top frame only.
  const w = window as unknown as {
    __aemAttached?: boolean;
    __aemRecord?: (a: unknown) => void;
    top: Window;
  };
  if (w.top !== window || w.__aemAttached || !w.__aemRecord) return;
  w.__aemAttached = true;

  const esc = (s: string) =>
    typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(s)
      : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

  function cssPath(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && node.tagName !== "BODY") {
      const tag = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;
      let nth = 1;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(
          (c) => c.tagName === node!.tagName,
        );
        nth = sameTag.indexOf(node) + 1;
      }
      parts.unshift(`${tag}:nth-of-type(${nth})`);
      node = parent;
    }
    return parts.join(" > ");
  }

  function selectorsFor(el: Element): string[] {
    const out: string[] = [];
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute("id");
    if (id) out.push(`#${esc(id)}`);
    const testid = el.getAttribute("data-testid");
    if (testid) out.push(`[data-testid="${testid}"]`);
    const name = el.getAttribute("name");
    if (name) out.push(`${tag}[name="${name}"]`);
    const aria = el.getAttribute("aria-label");
    if (aria) out.push(`${tag}[aria-label="${aria}"]`);
    out.push(cssPath(el));
    return out;
  }

  function accessibleName(el: Element): string {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const input = el as HTMLInputElement;
    if (input.labels && input.labels.length)
      return (input.labels[0].textContent || "").trim();
    const ph = el.getAttribute("placeholder");
    if (ph) return ph.trim();
    const title = el.getAttribute("title");
    if (title) return title.trim();
    const text = (el as HTMLElement).innerText || el.textContent || "";
    return text.trim().slice(0, 80);
  }

  function base(el: Element) {
    return {
      selectors: selectorsFor(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || undefined,
      name: accessibleName(el) || undefined,
    };
  }

  const send = (a: unknown) => {
    try {
      w.__aemRecord!(a);
    } catch {
      /* binding may be unavailable mid-teardown */
    }
  };

  document.addEventListener(
    "click",
    (e) => {
      const el = e.target as Element | null;
      if (!el || !el.tagName) return;
      const clickable =
        el.closest("button, a, [role='button'], input, label, select") || el;
      send({
        type: "click",
        ...base(clickable),
        text: ((clickable as HTMLElement).innerText || "").trim().slice(0, 80),
      });
    },
    true,
  );

  document.addEventListener(
    "change",
    (e) => {
      const el = e.target as HTMLInputElement | HTMLSelectElement | null;
      if (!el || !el.tagName) return;
      const tag = el.tagName.toLowerCase();
      if (tag === "select") {
        send({ type: "select", ...base(el), value: el.value });
      } else {
        const type = (el as HTMLInputElement).type;
        // Never capture secrets — record an empty, flagged value so the
        // generalizer turns it into a required per-run input (never a baked-in
        // constant, and never the raw/masked password text).
        if (type === "password") {
          send({ type: "input", ...base(el), value: "", sensitive: true });
        } else {
          send({ type: "input", ...base(el), value: el.value });
        }
      }
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (["Enter", "Tab", "Escape"].includes(e.key)) {
        const el = e.target as Element | null;
        send({ type: "key", key: e.key, ...(el ? base(el) : {}) });
      }
    },
    true,
  );

  document.addEventListener(
    "submit",
    (e) => {
      const el = e.target as Element | null;
      send({ type: "submit", ...(el ? base(el) : {}) });
    },
    true,
  );
}
