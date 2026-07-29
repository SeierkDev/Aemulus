// Service worker: buffers captured actions and, on stop, posts the trace to the
// Aemulus site (authenticated with the user's API key). The site turns it into a
// demonstration → skill. The buffer lives in chrome.storage because an MV3
// service worker can be torn down between events.

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
    return; // fire-and-forget
  }

  if (msg.__aem === "start") {
    chrome.storage.local.set({
      aemRecording: true,
      aemTrace: [],
      aemStartUrl: msg.startUrl || "",
      aemTitle: msg.title || "",
    }, () => sendResponse({ ok: true }));
    return true; // async response
  }

  if (msg.__aem === "stop") {
    stopAndSave().then(sendResponse);
    return true; // async response
  }
});

async function stopAndSave() {
  const cfg = await chrome.storage.local.get([
    "aemServer", "aemKey", "aemTrace", "aemStartUrl", "aemTitle",
  ]);
  await chrome.storage.local.set({ aemRecording: false });

  const server = String(cfg.aemServer || "").replace(/\/+$/, "");
  const key = String(cfg.aemKey || "");
  const trace = Array.isArray(cfg.aemTrace) ? cfg.aemTrace : [];

  if (!server || !key) return { ok: false, error: "Set your Aemulus URL and API key first." };
  if (trace.length === 0) return { ok: false, error: "No actions were recorded." };

  try {
    const res = await fetch(server + "/api/ext/trace", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        title: cfg.aemTitle || "",
        startUrl: cfg.aemStartUrl || "",
        actions: trace,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || "HTTP " + res.status };
    await chrome.storage.local.set({ aemTrace: [] });
    return { ok: true, demonstrationId: data.demonstrationId, steps: data.steps, server };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}
