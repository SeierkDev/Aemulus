// Aemulus in-page recorder (content script). Ported from the server recorder's
// in-page capture so a task recorded in YOUR browser produces the exact same
// trace shape the site already knows how to generalize. Listeners are always
// attached but only emit while recording is on (toggled from the popup).
(() => {
  const w = window;
  if (w.__aemExtAttached || w.top !== window) return;
  w.__aemExtAttached = true;

  let recording = false;

  const esc = (s) =>
    typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(s)
      : String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");

  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node.tagName !== "BODY") {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      let nth = 1;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        nth = sameTag.indexOf(node) + 1;
      }
      parts.unshift(`${tag}:nth-of-type(${nth})`);
      node = parent;
    }
    return parts.join(" > ");
  }

  function selectorsFor(el) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute("id");
    if (id) out.push(`#${esc(id)}`);
    const testid = el.getAttribute("data-testid");
    if (testid) out.push(`[data-testid="${testid}"]`);
    const name = el.getAttribute("name");
    if (name) out.push(`${tag}[name="${esc(name)}"]`);
    const aria = el.getAttribute("aria-label");
    if (aria) out.push(`${tag}[aria-label="${aria}"]`);
    out.push(cssPath(el));
    return out;
  }

  function accessibleName(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    if (el.labels && el.labels.length) return (el.labels[0].textContent || "").trim();
    const ph = el.getAttribute("placeholder");
    if (ph) return ph.trim();
    const title = el.getAttribute("title");
    if (title) return title.trim();
    return (el.innerText || el.textContent || "").trim().slice(0, 80);
  }

  function base(el) {
    return {
      selectors: selectorsFor(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || undefined,
      name: accessibleName(el) || undefined,
    };
  }

  function isSensitive(el) {
    if ((el.type || "").toLowerCase() === "password") return true;
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (/(^|\s)(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp)/.test(ac)) return true;
    const hints = [
      el.getAttribute("name"),
      el.getAttribute("id"),
      el.getAttribute("aria-label"),
      el.getAttribute("placeholder"),
      el.getAttribute("autocomplete"),
    ].join(" ").toLowerCase();
    return /pass|secret|token|otp|one[-_\s]?time|passcode|cvv|cvc|ccv|card[-_\s]?number|cardnumber|creditcard|security[-_\s]*code|\bssn\b|social.?security|routing|iban|\bpin\b|\bmfa\b|\b2fa\b|auth(?:entication)?[-_\s]?code|api[-_\s]?key/.test(hints);
  }

  function send(a) {
    if (!recording) return;
    try {
      chrome.runtime.sendMessage({ __aem: "action", action: { ...a, url: location.href, ts: Date.now() } });
    } catch {
      /* extension context invalidated / reloaded — ignore */
    }
  }

  document.addEventListener("click", (e) => {
    const el = e.target;
    if (!el || !el.tagName) return;
    const clickable = el.closest("button, a, [role='button'], input, label, select") || el;
    send({ type: "click", ...base(clickable), text: (clickable.innerText || "").trim().slice(0, 80) });
  }, true);

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!el || !el.tagName) return;
    if (el.tagName.toLowerCase() === "select") {
      send({ type: "select", ...base(el), value: el.value });
    } else if (isSensitive(el)) {
      send({ type: "input", ...base(el), value: "", sensitive: true });
    } else {
      send({ type: "input", ...base(el), value: el.value });
    }
  }, true);

  document.addEventListener("keydown", (e) => {
    if (["Enter", "Tab", "Escape"].includes(e.key)) {
      const el = e.target;
      send({ type: "key", key: e.key, ...(el && el.tagName ? base(el) : {}) });
    }
  }, true);

  document.addEventListener("submit", (e) => {
    const el = e.target;
    send({ type: "submit", ...(el && el.tagName ? base(el) : {}) });
  }, true);

  // Toggle recording from stored state; when it flips ON, log a navigate for the
  // current page so the trace starts with where we are.
  function setRecording(on) {
    const was = recording;
    recording = !!on;
    if (recording && !was) {
      try {
        chrome.runtime.sendMessage({
          __aem: "action",
          action: { type: "navigate", value: location.href, url: location.href, ts: Date.now() },
        });
      } catch { /* ignore */ }
    }
  }

  try {
    chrome.storage.local.get("aemRecording", (r) => setRecording(r && r.aemRecording));
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === "local" && ch.aemRecording) setRecording(ch.aemRecording.newValue);
    });
  } catch { /* not in extension context */ }
})();
