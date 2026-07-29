// Service worker. Two responsibilities:
//  - RECORD: buffer captured actions, then POST them to the site as a demonstration.
//  - RUN: drive a skill's plan step-by-step in the user's active tab (surviving
//    navigations), capture a proof screenshot per step, and POST the result to the
//    site — which settles the run exactly like a cloud run (receipt, earnings…).
// State lives in chrome.storage because an MV3 worker can be torn down between events.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.__aem) return;

  if (msg.__aem === "action") {
    chrome.storage.local.get({ aemTrace: [] }, (r) => {
      const trace = Array.isArray(r.aemTrace) ? r.aemTrace : [];
      if (trace.length < 1000) {
        trace.push(msg.action);
        chrome.storage.local.set({ aemTrace: trace });
      }
    });
    return;
  }
  if (msg.__aem === "start") {
    chrome.storage.local.set(
      { aemRecording: true, aemTrace: [], aemStartUrl: msg.startUrl || "", aemTitle: msg.title || "" },
      () => sendResponse({ ok: true }),
    );
    return true;
  }
  if (msg.__aem === "stop") { stopAndSave().then(sendResponse); return true; }
  if (msg.__aem === "run") { runSkill(msg).then(sendResponse); return true; }
  return undefined;
});

// ---------------- config + helpers ----------------
async function connection() {
  const c = await chrome.storage.local.get(["aemServer", "aemKey"]);
  return { server: String(c.aemServer || "").replace(/\/+$/, ""), key: String(c.aemKey || "") };
}
async function post(server, key, path, body) {
  const res = await fetch(server + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data, error: data && data.error };
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const setStatus = (s) => chrome.storage.local.set({ aemRunStatus: s });

function resolveValue(step, input) {
  if (step.valueSource === "input") return input[step.inputKey] != null ? input[step.inputKey] : "";
  return step.value != null ? step.value : "";
}

function pingOnce(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { __aem: "ping" }, (resp) => {
        resolve(chrome.runtime.lastError ? null : resp);
      });
    } catch { resolve(null); }
  });
}
async function ensureReady(tabId, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await pingOnce(tabId);
    if (r && r.ready) return true;
    await delay(400);
  }
  return false;
}
function perform(tabId, step, value, forcedSelector) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { __aem: "perform", step, value, forcedSelector }, (resp) => {
        resolve(chrome.runtime.lastError ? null : resp);
      });
    } catch { resolve(null); }
  });
}
function getCandidates(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { __aem: "candidates" }, (resp) => {
        resolve(chrome.runtime.lastError ? { candidates: [] } : resp || { candidates: [] });
      });
    } catch { resolve({ candidates: [] }); }
  });
}
function navigateAndWait(tabId, url) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(listener); clearTimeout(to); resolve(); };
    const listener = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
    chrome.tabs.onUpdated.addListener(listener);
    const to = setTimeout(finish, 20000);
    chrome.tabs.update(tabId, { url });
  });
}
function waitComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const check = () => {
      chrome.tabs.get(tabId, (t) => {
        if (chrome.runtime.lastError || !t || t.status === "complete") finish();
        else if (!done) setTimeout(check, 300);
      });
    };
    setTimeout(finish, timeoutMs);
    check();
  });
}
async function settle(tabId) { await delay(600); await waitComplete(tabId, 15000); }
function safeCapture(windowId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 55 }, (dataUrl) => {
        resolve(chrome.runtime.lastError || !dataUrl ? undefined : dataUrl);
      });
    } catch { resolve(undefined); }
  });
}

// ---------------- RECORD ----------------
async function stopAndSave() {
  const { server, key } = await connection();
  const cfg = await chrome.storage.local.get(["aemTrace", "aemStartUrl", "aemTitle"]);
  await chrome.storage.local.set({ aemRecording: false });
  const trace = Array.isArray(cfg.aemTrace) ? cfg.aemTrace : [];
  if (!server || !key) return { ok: false, error: "Set your Aemulus URL and API key first." };
  if (trace.length === 0) return { ok: false, error: "No actions were recorded." };
  try {
    const r = await post(server, key, "/api/ext/trace", {
      title: cfg.aemTitle || "", startUrl: cfg.aemStartUrl || "", actions: trace,
    });
    if (!r.ok) return { ok: false, error: r.error || "HTTP " + r.status };
    await chrome.storage.local.set({ aemTrace: [] });
    return { ok: true, demonstrationId: r.data.demonstrationId, steps: r.data.steps, server };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

// ---------------- RUN (replay in the user's browser) ----------------
const CONFIDENCE_FLOOR = 0.6; // below this, flag for human review (calibrated autonomy)

async function runSkill(msg) {
  const { server, key } = await connection();
  if (!server || !key) return { ok: false, error: "Set your Aemulus URL and API key first." };
  const input = msg.input || {};

  await setStatus({ state: "starting" });
  let start;
  try {
    start = await post(server, key, "/api/ext/runs/start", { skillId: msg.skillId, input });
  } catch (e) { const err = (e && e.message) || String(e); await setStatus({ state: "error", error: err }); return { ok: false, error: err }; }
  if (!start.ok) { await setStatus({ state: "error", error: start.error }); return { ok: false, error: start.error }; }

  const { runId, plan, startUrl, secretKeys } = start.data;
  const secret = new Set(secretKeys || []);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return { ok: false, error: "No active tab." };
  const tabId = tab.id, windowId = tab.windowId;

  const results = [];
  let status = "completed";
  let error = null;
  let tokensIn = 0, tokensOut = 0;

  if (startUrl) await navigateAndWait(tabId, startUrl);

  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const isSecret = secret.has(step.inputKey);
    const value = resolveValue(step, input);
    await setStatus({ state: "running", step: i + 1, total: plan.length, intent: step.intent, runId, server });

    if (step.action === "navigate") {
      const url = value || step.target;
      try { await navigateAndWait(tabId, url); } catch { /* keep going */ }
      results.push({ idx: step.idx, selectorUsed: "", value: url, confidence: 1, screenshot: await safeCapture(windowId) });
      continue;
    }

    await ensureReady(tabId, 15000);
    let res = await perform(tabId, step, value);
    let selectorUsed = (res && res.selectorUsed) || "";
    let confidence = res && res.ok ? (res.confidence != null ? res.confidence : 0.99) : 0;
    let flagged = false;
    let note = "";

    // Deterministic selector missed → vision fallback (the operator picks the
    // element from the live page's candidates). Added in Phase 3.
    if (!res || !res.ok) {
      const rescue = await visionRescue(server, key, runId, tabId, step, value);
      tokensIn += rescue.tokensIn; tokensOut += rescue.tokensOut;
      if (rescue.ok) {
        selectorUsed = rescue.selectorUsed;
        confidence = rescue.confidence;
        flagged = rescue.confidence < CONFIDENCE_FLOOR;
        note = flagged ? `Vision fallback, low confidence (${rescue.confidence.toFixed(2)}).` : "Recovered via vision fallback.";
      } else {
        flagged = true;
        note = "The step could not be located, even with the vision fallback.";
        status = "needs_review";
        error = "A step could not be located on the page.";
        results.push({ idx: step.idx, selectorUsed, value: isSecret ? "" : value, confidence: 0, flagged, note, screenshot: await safeCapture(windowId) });
        break;
      }
    }

    await settle(tabId);
    results.push({
      idx: step.idx,
      selectorUsed,
      value: isSecret ? "" : value,
      confidence,
      flagged,
      note,
      screenshot: isSecret ? undefined : await safeCapture(windowId),
    });
  }

  await setStatus({ state: "finishing", runId, server });
  let fin;
  try {
    fin = await post(server, key, `/api/ext/runs/${runId}/finish`, { status, error, steps: results, tokensIn, tokensOut });
  } catch (e) { const err = (e && e.message) || String(e); await setStatus({ state: "error", error: err, runId, server }); return { ok: false, error: err }; }
  const receiptHash = fin.data && fin.data.receiptHash;
  await setStatus({ state: "done", status, runId, server, receiptHash });
  return { ok: true, status, runId, server };
}

// Vision fallback: collect the page's candidate elements + a screenshot, ask the
// server operator (Claude) to pick the element, and retry the step with that
// selector. Returns tokens used so the run's cost is honest.
async function visionRescue(server, key, runId, tabId, step, value) {
  const empty = { ok: false, tokensIn: 0, tokensOut: 0, selectorUsed: "", confidence: 0 };
  try {
    const cand = await getCandidates(tabId);
    const shot = await captureForWindow(tabId);
    const r = await post(server, key, `/api/ext/runs/${runId}/operate`, {
      intent: step.intent,
      action: step.action,
      candidates: (cand && cand.candidates) || [],
      screenshot: shot,
    });
    if (!r.ok || !r.data || !r.data.selector) {
      return { ...empty, tokensIn: (r.data && r.data.tokensIn) || 0, tokensOut: (r.data && r.data.tokensOut) || 0 };
    }
    const chosen = r.data.selector;
    const conf = typeof r.data.confidence === "number" ? r.data.confidence : 0.5;
    await ensureReady(tabId, 8000);
    const res = await perform(tabId, step, value, chosen);
    if (res && res.ok) {
      return { ok: true, selectorUsed: chosen, confidence: conf, tokensIn: r.data.tokensIn || 0, tokensOut: r.data.tokensOut || 0 };
    }
    return { ...empty, tokensIn: r.data.tokensIn || 0, tokensOut: r.data.tokensOut || 0 };
  } catch {
    return empty;
  }
}
async function captureForWindow(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (t) => {
      if (chrome.runtime.lastError || !t) return resolve(undefined);
      safeCapture(t.windowId).then(resolve);
    });
  });
}
