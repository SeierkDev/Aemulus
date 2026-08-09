// Service worker. Two responsibilities:
//  - RECORD: buffer captured actions, then POST them to the site as a demonstration.
//  - RUN: drive a skill's plan step-by-step in the user's active tab (surviving
//    navigations), capture a proof screenshot per step, and POST the result to the
//    site — which settles the run exactly like a cloud run (receipt, earnings…).
// State lives in chrome.storage because an MV3 worker can be torn down between events.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.__aem) return;

  // A wait_for step can hold the page for minutes while this worker has nothing
  // to do, and an idle MV3 service worker is terminated — taking the pending
  // step response with it, so the run would die partway through for no reason
  // the person could see. The content script pings while it waits; receiving
  // the message is the point, and answering it keeps the channel honest.
  if (msg.__aem === "waiting") { sendResponse({ ok: true }); return true; }

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
  // Triggered from the site's "Run in your browser" button (relayed by the
  // content script): run in a fresh tab so it doesn't hijack the site tab.
  if (msg.__aem === "runExternal") { runSkill({ skillId: msg.skillId, input: msg.input, newTab: true }); return; }
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
/** Mirrors branchSpan in lib/watches: how many steps a branch governs. */
function branchSpan(cond) {
  const n = Math.floor((cond && cond.span) || 1);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(50, n);
}

function askCondition(tabId, condition) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { __aem: "cond", condition }, (resp) => {
        // No answer means we could not read the page. Treat that as "do not
        // run": a branch that cannot be judged must not take the path that
        // DOES something on the strength of not knowing.
        resolve(chrome.runtime.lastError ? false : !!(resp && resp.met));
      });
    } catch { resolve(false); }
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

  // Pick the tab to run in: a fresh tab for site-triggered runs (so we don't
  // hijack the site), the active tab for popup-triggered runs.
  let tabId, windowId;
  if (msg.newTab) {
    const created = await chrome.tabs.create({ url: startUrl || "about:blank", active: true });
    tabId = created.id; windowId = created.windowId;
    if (startUrl) await waitComplete(tabId, 20000);
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) { await setStatus({ state: "error", error: "No active tab." }); return { ok: false, error: "No active tab." }; }
    tabId = tab.id; windowId = tab.windowId;
    if (startUrl) await navigateAndWait(tabId, startUrl);
  }

  const results = [];
  /** What each extract step read, keyed by its output name. */
  const outputs = {};
  let status = "completed";
  let error = null;
  let tokensIn = 0, tokensOut = 0;

  // The last position covered by a branch whose condition did not hold.
  let skipThrough = -1;

  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const isSecret = secret.has(step.inputKey);
    const value = resolveValue(step, input);

    // Branching, which this driver did not do at all: a conditional step ran
    // unconditionally here while the cloud skipped it, so the same skill did
    // different work depending on where it ran.
    //
    // One place a step is skipped, for the same reason the runner has one: both
    // ways in have to remember that a skipped step which is ITSELF a branch
    // takes its group with it, or the steps it gates run with their gate never
    // evaluated. Recorded rather than passed over, because a step missing from
    // the record cannot be told apart from a step that never existed.
    const skipStep = async (note) => {
      if (step.condition) {
        skipThrough = Math.max(skipThrough, i + branchSpan(step.condition) - 1);
      }
      results.push({ idx: step.idx, selectorUsed: "", value: "", confidence: 1, flagged: false, note, screenshot: await safeCapture(windowId) });
    };

    if (i <= skipThrough) {
      await skipStep("Skipped: inside a branch that didn't run.");
      continue;
    }
    if (step.condition) {
      // A page that cannot be reached is not a condition that did not hold.
      // Treated as "not met", a closed or crashed tab would skip this step and
      // everything its branch covers — and then the next branch, and the next —
      // so a run that did nothing could finish saying it was fine. The cloud
      // runner fails the run here; so does this.
      if (!(await ensureReady(tabId, 15000))) {
        status = "needs_review";
        error = "The page could not be reached to check a step's condition.";
        results.push({ idx: step.idx, selectorUsed: "", value: "", confidence: 0, flagged: true, note: "Could not reach the page to check this step's condition.", screenshot: await safeCapture(windowId) });
        break;
      }
      if (!(await askCondition(tabId, step.condition))) {
        await skipStep("Skipped: its condition was not met.");
        continue;
      }
    }

    // Announced after the branching, not before it: the popup used to name a
    // step as running and then skip it, which is the one place this driver
    // tells a person what it is doing right now.
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

    // A wait that ran out never reaches the vision fallback.
    //
    // A missed selector means the element moved and vision can find it again. A
    // wait running out means the thing the author said to wait for did not
    // happen, which is not a locating problem: the fallback would spend tokens
    // hunting an element that is not there and, worse, "recover" the step by
    // pointing at something else — so a run told to stop would carry on as if
    // the approval had landed. It is also the one place the two runners could
    // disagree about the same skill, since the cloud has no fallback here.
    if (step.action === "wait_for") {
      if (res && res.ok) {
        flagged = !!res.timedOut;
        note = res.timedOut
          ? "Waited and it never arrived; carried on, as the step says to."
          : "Waited and it was there.";
      } else {
        flagged = true;
        note = "Waited and it never arrived.";
        status = "needs_review";
        error = "A step waited for the page and it never got there.";
        results.push({ idx: step.idx, selectorUsed, value: "", confidence: 0, flagged, note, screenshot: await safeCapture(windowId) });
        break;
      }
    }

    // Deterministic selector missed → vision fallback (the operator picks the
    // element from the live page's candidates). Added in Phase 3.
    let extracted;
    if (step.action !== "wait_for" && (!res || !res.ok)) {
      const rescue = await visionRescue(server, key, runId, tabId, step, value);
      tokensIn += rescue.tokensIn; tokensOut += rescue.tokensOut;
      if (rescue.ok) {
        selectorUsed = rescue.selectorUsed;
        confidence = rescue.confidence;
        extracted = rescue.value;
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
    // An extract step's whole purpose is the value it read. The cloud runner
    // collects these into the run's output; the extension was dropping them, so
    // a capture recorded in your own browser could never be watched.
    // `read` rather than res.value: on a rescued step res holds the FAILED
    // attempt, and the value came back from the vision path instead. Naming it
    // outKey, not key — key is the API key this function posts with.
    const read = String((extracted !== undefined ? extracted : res && res.value) || "");
    if (step.action === "extract") {
      const outKey = step.outputKey || `value_${step.idx}`;
      // 4000 = the finish route's own cap. Slicing shorter here would silently
      // shorten a value the server was willing to store.
      outputs[outKey] = read.slice(0, 4000);
    }
    results.push({
      idx: step.idx,
      selectorUsed,
      value: step.action === "extract" ? read.slice(0, 300) : (isSecret ? "" : value),
      confidence,
      flagged,
      note,
      screenshot: isSecret ? undefined : await safeCapture(windowId),
    });
  }

  await setStatus({ state: "finishing", runId, server });
  let fin;
  try {
    fin = await post(server, key, `/api/ext/runs/${runId}/finish`, { status, error, steps: results, outputs, tokensIn, tokensOut });
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
      // value rides along: an extract rescued by the vision fallback still has
      // to report what it read, or the output is silently empty on exactly the
      // runs where the page had drifted.
      return { ok: true, selectorUsed: chosen, confidence: conf, value: res.value, tokensIn: r.data.tokensIn || 0, tokensOut: r.data.tokensOut || 0 };
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
