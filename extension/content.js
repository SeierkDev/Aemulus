// Aemulus content script — two jobs:
//  1. RECORD: capture the user's clicks/typing (same shape the server recorder
//     produces) while recording is on.
//  2. REPLAY: on request from the service worker, perform one step of a skill in
//     this page and report the result (with the selector it used + confidence),
//     or collect candidate elements for the vision fallback.
// Recording listeners are gated by `recording`, so replay's synthetic events
// never get recorded.
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
      el.getAttribute("name"), el.getAttribute("id"), el.getAttribute("aria-label"),
      el.getAttribute("placeholder"), el.getAttribute("autocomplete"),
    ].join(" ").toLowerCase();
    return /pass|secret|token|otp|one[-_\s]?time|passcode|cvv|cvc|ccv|card[-_\s]?number|cardnumber|creditcard|security[-_\s]*code|\bssn\b|social.?security|routing|iban|\bpin\b|\bmfa\b|\b2fa\b|auth(?:entication)?[-_\s]?code|api[-_\s]?key/.test(hints);
  }

  // ---------- RECORD ----------
  function send(a) {
    if (!recording) return;
    try {
      chrome.runtime.sendMessage({ __aem: "action", action: { ...a, url: location.href, ts: Date.now() } });
    } catch { /* extension reloaded */ }
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
    if (el.tagName.toLowerCase() === "select") send({ type: "select", ...base(el), value: el.value });
    else if (isSensitive(el)) send({ type: "input", ...base(el), value: "", sensitive: true });
    else send({ type: "input", ...base(el), value: el.value });
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

  function setRecording(on) {
    const was = recording;
    recording = !!on;
    if (recording && !was) {
      try {
        chrome.runtime.sendMessage({ __aem: "action", action: { type: "navigate", value: location.href, url: location.href, ts: Date.now() } });
      } catch { /* ignore */ }
    }
  }
  try {
    chrome.storage.local.get("aemRecording", (r) => setRecording(r && r.aemRecording));
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === "local" && ch.aemRecording) setRecording(ch.aemRecording.newValue);
    });
  } catch { /* not in extension context */ }

  // ---------- REPLAY ----------
  function resolve(selectors) {
    for (const sel of selectors || []) {
      try {
        const el = document.querySelector(sel);
        if (el) return { el, sel };
      } catch { /* invalid selector */ }
    }
    return { el: null, sel: "" };
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function performStep(step, value, forcedSelector) {
    const action = step.action;
    if (action === "navigate") return { ok: true, selectorUsed: "", confidence: 1 };

    let el = null, used = "";
    if (forcedSelector) {
      try { el = document.querySelector(forcedSelector); used = forcedSelector; } catch { el = null; }
    } else {
      const r = resolve(step.selectors);
      el = r.el; used = r.sel;
    }

    // key events can target the active element / document if no element resolved
    if (!el && action !== "key") return { ok: false, reason: "element-not-found" };

    try {
      if (action === "click") {
        el.scrollIntoView({ block: "center", inline: "center" });
        el.click();
      } else if (action === "input") {
        el.focus();
        setNativeValue(el, value || "");
      } else if (action === "select") {
        setNativeValue(el, value || "");
      } else if (action === "key") {
        const target = el || document.activeElement || document.body;
        const key = step.key || "Enter";
        for (const t of ["keydown", "keyup"]) {
          target.dispatchEvent(new KeyboardEvent(t, { key, bubbles: true }));
        }
        if (key === "Enter") {
          const form = target.closest && target.closest("form");
          if (form) (form.requestSubmit ? form.requestSubmit() : form.submit());
        }
      } else if (action === "submit") {
        const form = (el && el.closest("form")) || document.querySelector("form");
        if (form) (form.requestSubmit ? form.requestSubmit() : form.submit());
      }
      return { ok: true, selectorUsed: forcedSelector ? used : used, confidence: forcedSelector ? undefined : 0.99 };
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) };
    }
  }

  function collectCandidates() {
    const out = [];
    const els = document.querySelectorAll(
      "button, a, input, select, textarea, [role='button'], [role='link'], [onclick], [contenteditable='true']",
    );
    for (let i = 0; i < els.length && out.length < 60; i++) {
      const el = els[i];
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue; // skip hidden
      out.push({
        selector: selectorsFor(el)[0] || cssPath(el),
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.value || "").trim().slice(0, 60),
        name: (accessibleName(el) || "").slice(0, 60),
        role: el.getAttribute("role") || undefined,
      });
    }
    return out;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || !msg.__aem) return;
    if (msg.__aem === "ping") { reply({ ready: true, url: location.href }); return true; }
    if (msg.__aem === "perform") { reply(performStep(msg.step, msg.value, msg.forcedSelector)); return true; }
    if (msg.__aem === "candidates") { reply({ candidates: collectCandidates() }); return true; }
  });
})();
