const $ = (id) => document.getElementById(id);

function setState(recording) {
  $("start").disabled = recording;
  $("stop").disabled = !recording;
  $("recdot").style.opacity = recording ? "1" : "0.2";
}
function status(text) { $("status").textContent = text; }

chrome.storage.local.get(["aemServer", "aemKey", "aemTitle", "aemRecording"], (c) => {
  $("server").value = c.aemServer || "";
  $("key").value = c.aemKey || "";
  $("title").value = c.aemTitle || "";
  setState(!!c.aemRecording);
  if (c.aemRecording) status("Recording — do your task, then Stop & save.");
});

function saveConn() {
  chrome.storage.local.set({
    aemServer: $("server").value.trim(),
    aemKey: $("key").value.trim(),
  });
}

$("save").onclick = () => { saveConn(); status("Connection saved."); };

$("start").onclick = async () => {
  if (!$("server").value.trim() || !$("key").value.trim()) {
    status("Enter your Aemulus URL and API key first.");
    return;
  }
  saveConn();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.runtime.sendMessage(
    { __aem: "start", startUrl: (tab && tab.url) || "", title: $("title").value.trim() },
    () => {
      setState(true);
      $("link").style.display = "none";
      status("Recording — do your task in this tab, then Stop & save.");
    },
  );
};

$("stop").onclick = () => {
  status("Saving…");
  chrome.runtime.sendMessage({ __aem: "stop" }, (res) => {
    setState(false);
    if (res && res.ok) {
      status(`Saved ${res.steps || ""} steps. Open your recordings to make a skill.`);
      $("link").href = (res.server || "") + "/skills";
      $("link").style.display = "inline";
    } else {
      status("Error: " + ((res && res.error) || "unknown"));
    }
  });
};
