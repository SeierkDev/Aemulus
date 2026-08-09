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

  // Let the site know we are here. /record used to tell everyone to install the
  // extension whether they had it or not, which reads as a site that knows
  // nothing about you. Absence of this attribute is not proof of absence — the
  // script only injects where it has access — so the page only ever softens its
  // nudge, never gates anything on it.
  try {
    document.documentElement.setAttribute("data-aemulus-extension", "1");
    w.__aemulusExtension = true;
  } catch { /* hostile page may seal the element */ }

  let recording = false;
  let capturing = false;
  let captureKey = "";
  let watchOp = "";
  let watchValue = "";
  // Same default as the cloud runner's AEMULUS_LOOP_MAX. A page with thousands
  // of rows must not turn one step into an unbounded payload.
  const LOOP_MAX = 500;

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

  // ---- capture mode ----------------------------------------------------
  // A watch needs a skill that READS a value. Until now the only way to make
  // one was to open DevTools, copy a CSS selector and paste it into the skill
  // editor. Here you point at the value and click it.
  let outline = null;
  function showOutline(el) {
    if (!outline) {
      outline = document.createElement("div");
      outline.setAttribute("data-aem-outline", "1");
      outline.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #f4f4f5;" +
        "border-radius:4px;box-shadow:0 0 0 2px rgba(0,0,0,.55);display:none";
      document.documentElement.appendChild(outline);
    }
    if (!el) { outline.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    outline.style.display = "block";
    outline.style.left = (r.left - 2) + "px";
    outline.style.top = (r.top - 2) + "px";
    outline.style.width = r.width + "px";
    outline.style.height = r.height + "px";
  }
  /**
   * What a capture reads.
   *
   * textContent, NOT innerText — that is what the runner uses (captureValue in
   * lib/runner.ts). They disagree on hidden nodes and whitespace, so previewing
   * one and capturing the other shows a value the watch will never compare
   * against.
   *
   * `max` because the two uses want different limits. While RECORDING it is a
   * preview, and 300 characters is plenty to see you grabbed the right thing.
   * While REPLAYING it is the value itself, and truncating at 300 would mean a
   * long value read differently here than in the cloud — a watch would then see
   * a change that never happened, or miss one past character 300.
   *
   * The replay ceiling is the server's own limit for a client-reported output
   * (4000, in the finish route) rather than the cloud runner's 20,000: the
   * runner reads the page itself, while this is a number the extension claims,
   * so the tighter bound on the untrusted path is deliberate.
   */
  const CAPTURE_PREVIEW_MAX = 300;
  const CAPTURE_VALUE_MAX = 4000;
  function readValue(el, max) {
    const cap = max || CAPTURE_VALUE_MAX;
    if (/^(input|textarea|select)$/i.test(el.tagName) && el.value !== undefined) {
      return String(el.value).trim().slice(0, cap);
    }
    return (el.textContent || "").trim().slice(0, cap);
  }
  document.addEventListener("mousemove", (e) => {
    if (!recording || !capturing) { if (outline) outline.style.display = "none"; return; }
    const el = e.target;
    if (!el || !el.tagName || el.hasAttribute("data-aem-outline")) return;
    showOutline(el);
  }, true);

  document.addEventListener("click", (e) => {
    const el = e.target;
    if (!el || !el.tagName) return;

    if (recording && capturing) {
      // Swallow it. A capture is not a click, and letting it through would
      // follow the link or submit the form and move the page out from under the
      // value being pointed at.
      e.preventDefault();
      e.stopPropagation();
      // A capture on a credential field is still a credential — same redaction
      // the typed-input path has always applied.
      const secret = isSensitive(el);
      send({
        type: "extract",
        ...base(el),
        value: secret ? "" : readValue(el, CAPTURE_PREVIEW_MAX),
        ...(secret ? { sensitive: true } : {}),
        outputKey: captureKey || undefined,
        // The rule set at the moment of the click. Undefined when the user left
        // it on "tell me when it changes", which is the existing behaviour and
        // needs no rule stored.
        watchOp: watchOp || undefined,
        watchValue: watchOp && watchValue ? watchValue : undefined,
        text: (el.innerText || "").trim().slice(0, 80),
      });
      return;
    }

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
  function setCapturing(on, key) {
    capturing = !!on;
    if (key !== undefined) captureKey = String(key || "");
    if (!capturing && outline) outline.style.display = "none";
  }
  try {
    chrome.storage.local.get(
      ["aemRecording", "aemCapturing", "aemCaptureKey", "aemWatchOp", "aemWatchValue"],
      (r) => {
        setRecording(r && r.aemRecording);
        setCapturing(r && r.aemCapturing, r && r.aemCaptureKey);
        watchOp = String((r && r.aemWatchOp) || "");
        watchValue = String((r && r.aemWatchValue) || "");
      },
    );
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== "local") return;
      if (ch.aemRecording) setRecording(ch.aemRecording.newValue);
      // Without this the toggle only takes effect on the next page load, which
      // is exactly the wrong moment — you turn it on to grab the value on the
      // page you are already looking at.
      if (ch.aemCapturing) setCapturing(ch.aemCapturing.newValue);
      if (ch.aemCaptureKey) captureKey = String(ch.aemCaptureKey.newValue || "");
      // Same reason as the key: a rule edited in the popup has to reach the page
      // you are already standing on, not the next one.
      if (ch.aemWatchOp) watchOp = String(ch.aemWatchOp.newValue || "");
      if (ch.aemWatchValue) watchValue = String(ch.aemWatchValue.newValue || "");
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

  // ---------- WAITING ----------
  // Mirrors lib/watches.ts. A content script cannot import from the server
  // bundle, so this is a copy, and a copy that drifts is worse than no copy at
  // all: the same skill would wait for different things depending on where it
  // ran. tests/wait-step.test.ts pins the two against each other.
  const AEM_ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
  function aemNormalize(s) {
    return String(s).replace(AEM_ZERO_WIDTH, "").replace(/\s+/g, " ").trim();
  }
  function aemNumber(s) {
    const m = aemNormalize(s).replace(/[ \s]/g, "").match(/-?\d[\d,]*\.?\d*/);
    if (!m) return null;
    const n = Number(m[0].replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  /** One reading, one answer. null reading = the element is not on the page. */
  function aemHolds(op, operand, reading) {
    const text = reading === null ? "" : aemNormalize(reading);
    if (op === "appears") return reading !== null && text !== "";
    if (op === "disappears") return reading === null || text === "";
    // A missing element cannot satisfy a claim about its text. Without this,
    // "not_contains" is true for an element that never rendered.
    if (reading === null) return false;
    const want = aemNormalize(operand);
    if (op === "equals") return text === want;
    if (op === "contains") return text.includes(want);
    if (op === "not_contains") return !text.includes(want);
    if (op === "above" || op === "below") {
      const a = aemNumber(text), b = aemNumber(want);
      if (a === null || b === null) return null;
      return op === "above" ? a > b : a < b;
    }
    return null;
  }

  /**
   * Playwright's definition, so both runners answer the same question: an
   * element is visible when it has a non-empty box and is not visibility:hidden.
   * display:none has no boxes, so it is covered.
   */
  function aemVisible(el) {
    try {
      if (!el.getClientRects || el.getClientRects().length === 0) return false;
      return getComputedStyle(el).visibility !== "hidden";
    } catch { return false; }
  }

  const WAIT_POLL_MS = 500;
  const WAIT_MAX_MS = 5 * 60 * 1000;
  const WAIT_DEFAULT_MS = 30000;

  /** Hold here until the page says so, or until the step's time runs out. */
  function waitForStep(step) {
    const op = step.waitOp || "appears";
    const operand = step.waitValue || "";
    const limit = Math.min(Math.max(1000, step.waitMs || WAIT_DEFAULT_MS), WAIT_MAX_MS);
    const until = Date.now() + limit;
    const sels = step.selectors || [];
    return new Promise((done) => {
      let usedSel = "";
      let lastPing = Date.now();
      const tick = () => {
        // The recorded selectors are ALTERNATIVE ways to find one element, so
        // the first that finds it wins and its reading is the one judged.
        // Asking whether ANY of them satisfied meant "stops showing a value"
        // was satisfied by the first spare selector that no longer matched,
        // while the element was still there under the one that did.
        let reading = null;
        let usedNow = "";
        for (const sel of sels) {
          let r = null;
          try {
            // Visible, like the cloud runner resolves a selector: an overlay
            // hidden with CSS still has its text, and a not-yet-shown element
            // would satisfy "starts showing a value" before it was there.
            const found = document.querySelector(sel);
            const e = found && aemVisible(found) ? found : null;
            // Same ceiling the cloud reads to. At the capture default a long
            // element is cut at 4,000 characters here and 20,000 there, so a
            // "contains" whose match sits past the cut would never be satisfied
            // locally and would be satisfied in the cloud.
            r = e ? readValue(e, 20000) : null;
          } catch { r = null; }
          if (r !== null) { reading = r; usedNow = sel; break; }
        }
        if (reading !== null) usedSel = usedNow;
        if (aemHolds(op, operand, reading) === true) {
          done({ ok: true, selectorUsed: usedNow || usedSel, confidence: 1 });
          return;
        }
        // Keep the service worker alive across a long wait (see background.js).
        if (Date.now() - lastPing >= 20000) {
          lastPing = Date.now();
          try { chrome.runtime.sendMessage({ __aem: "waiting" }, () => void chrome.runtime.lastError); } catch { /* the worker will be woken by the reply anyway */ }
        }
        if (Date.now() >= until) {
          // "continue" is the author saying the rest of the skill works without
          // it. Reporting failure then would stop a run they said to carry on.
          // timedOut either way, so the driver can record what happened rather
          // than filing a carried-on wait as a clean success.
          done(
            (step.waitOnTimeout || "fail") === "continue"
              ? { ok: true, selectorUsed: usedSel, confidence: 1, timedOut: true }
              : { ok: false, reason: "wait-timeout", timedOut: true },
          );
          return;
        }
        setTimeout(tick, WAIT_POLL_MS);
      };
      tick();
    });
  }

  /**
   * Does a step's branch condition hold right now?
   *
   * The extension had no answer to this at all: a conditional step ran
   * unconditionally here while the cloud skipped it, so the same skill did
   * different work depending on where it ran. Same reader and same vocabulary
   * as the wait above, so both sides ask one question.
   */
  function conditionMet(cond) {
    if (!cond) return true;
    let el = null;
    try {
      const found = document.querySelector(cond.selector);
      el = found && aemVisible(found) ? found : null;
    } catch { el = null; }
    if (cond.op) {
      // Inconclusive is not a reason to run.
      return aemHolds(cond.op, cond.value || "", el ? readValue(el, 20000) : null) === true;
    }
    let present = false;
    try { present = !!document.querySelector(cond.selector); } catch { present = false; }
    return cond.kind === "exists" ? present : !present;
  }

  function performStep(step, value, forcedSelector) {
    const action = step.action;
    if (action === "navigate") return { ok: true, selectorUsed: "", confidence: 1 };
    // Before the resolve below, deliberately: a wait exists precisely because
    // the element is not there yet, and the shared "element-not-found" exit
    // would refuse every wait that had anything to wait for.
    if (action === "wait_for") return waitForStep(step);

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
      } else if (action === "extract") {
        // Read it, do not act on it. Without this branch an extract step fell
        // through every case and returned ok having read nothing — so a skill
        // with a capture ran "successfully" and produced no value, and a watch
        // on it failed every single check with "did not capture the field".
        //
        // step.loop mirrors the cloud runner: capture EVERY element matching
        // the selector into a JSON array, not just the first. Ignoring it here
        // meant the same skill produced a single value in the extension and an
        // array in the cloud — a watch would then compare one shape against the
        // other depending on where the run happened.
        if (step.loop) {
          let els = [];
          try { els = Array.from(document.querySelectorAll(used)); } catch { els = []; }
          // NOT .map(readValue): map passes (element, index, array), so the
          // index would land in readValue's `max` and truncate element 1 to one
          // character, element 2 to two, and so on.
          const values = els.slice(0, LOOP_MAX).map((e) => readValue(e));
          return {
            ok: true,
            selectorUsed: used,
            confidence: forcedSelector ? undefined : 0.99,
            value: JSON.stringify(values),
          };
        }
        return {
          ok: true,
          selectorUsed: used,
          confidence: forcedSelector ? undefined : 0.99,
          value: readValue(el),
        };
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
    if (msg.__aem === "perform") {
      // A wait_for step answers later. Promise.resolve keeps every other step
      // on exactly the path it had.
      Promise.resolve(performStep(msg.step, msg.value, msg.forcedSelector)).then(reply);
      return true;
    }
    if (msg.__aem === "cond") { reply({ met: conditionMet(msg.condition) }); return true; }
    if (msg.__aem === "candidates") { reply({ candidates: collectCandidates() }); return true; }
  });

  // ---------- SITE HANDOFF ----------
  // Mark the DOM so the Aemulus site can tell the extension is installed and show
  // a "Run in your browser" button. The DOM is shared with the page (unlike the
  // isolated content-script `window`).
  try {
    document.documentElement.setAttribute("data-aemulus-extension", "0.1.0");
  } catch { /* ignore */ }

  // Relay a run request the site page posts to us (same-window/origin only) to
  // the service worker, which runs the skill in a fresh tab.
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__aemulusRun !== true) return;
    const skillId = String(e.data.skillId || "");
    if (!skillId) return;
    const input = e.data.input && typeof e.data.input === "object" ? e.data.input : {};
    try {
      chrome.runtime.sendMessage({ __aem: "runExternal", skillId, input });
      window.postMessage({ __aemulusAck: true, skillId }, location.origin);
    } catch { /* extension reloaded */ }
  });
})();
