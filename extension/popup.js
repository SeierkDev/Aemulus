const $ = (id) => document.getElementById(id);
let SKILLS = [];
let statusTimer = null;

function setRecState(recording) {
  $("start").disabled = recording;
  $("stop").disabled = !recording;
  $("recdot").style.opacity = recording ? "1" : "0.2";
}
function status(text) { $("status").textContent = text; }
function showLink(url, label) {
  $("link").href = url;
  $("link").textContent = label || "Open on the site →";
  $("link").style.display = "inline";
}

function saveConn() {
  chrome.storage.local.set({ aemServer: $("server").value.trim(), aemKey: $("key").value.trim() });
}

async function loadSkills() {
  const server = $("server").value.trim().replace(/\/+$/, "");
  const key = $("key").value.trim();
  if (!server || !key) { $("skill").innerHTML = '<option value="">Save connection first</option>'; return; }
  try {
    const res = await fetch(server + "/api/ext/skills", { headers: { Authorization: "Bearer " + key } });
    const data = await res.json();
    if (!res.ok) { $("skill").innerHTML = `<option value="">${(data && data.error) || "Couldn't load skills"}</option>`; return; }
    SKILLS = data.skills || [];
    if (SKILLS.length === 0) {
      $("skill").innerHTML = '<option value="">No skills yet — record one first</option>';
      $("run").disabled = true;
      return;
    }
    $("skill").innerHTML =
      '<option value="">Choose a skill…</option>' +
      SKILLS.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  } catch {
    $("skill").innerHTML = '<option value="">Connection failed</option>';
  }
}

function renderFields() {
  const skill = SKILLS.find((s) => s.id === $("skill").value);
  const box = $("fields");
  box.innerHTML = "";
  if (!skill) { $("run").disabled = true; return; }
  for (const f of skill.fields) {
    const label = document.createElement("label");
    label.textContent = f.label + (f.secret ? " (secret)" : "");
    const inp = document.createElement("input");
    inp.className = "aem-field";
    inp.dataset.key = f.key;
    inp.type = f.secret ? "password" : "text";
    inp.placeholder = f.example || "";
    box.appendChild(label);
    box.appendChild(inp);
  }
  $("run").disabled = false;
}

function collectInput() {
  const input = {};
  document.querySelectorAll(".aem-field").forEach((el) => {
    if (el.value.trim() !== "") input[el.dataset.key] = el.value;
  });
  return input;
}

function pollRunStatus() {
  clearInterval(statusTimer);
  statusTimer = setInterval(() => {
    chrome.storage.local.get("aemRunStatus", (r) => {
      const s = r.aemRunStatus;
      if (!s) return;
      if (s.state === "running") status(`Step ${s.step}/${s.total}: ${s.intent || ""}`);
      else if (s.state === "starting") status("Starting…");
      else if (s.state === "finishing") status("Finishing + sealing the receipt…");
      else if (s.state === "done") {
        clearInterval(statusTimer);
        $("run").disabled = false;
        status(s.status === "completed" ? "Done ✓ — run recorded with proof." : `Finished: ${s.status} (open it to review).`);
        if (s.server && s.runId) showLink(`${s.server}/runs/${s.runId}`, "View this run →");
      } else if (s.state === "error") {
        clearInterval(statusTimer);
        $("run").disabled = false;
        status("Error: " + (s.error || "unknown"));
      }
    });
  }, 500);
}

// ---- wire up ----
chrome.storage.local.get(["aemServer", "aemKey", "aemTitle", "aemRecording"], (c) => {
  $("server").value = c.aemServer || "";
  $("key").value = c.aemKey || "";
  $("title").value = c.aemTitle || "";
  setRecState(!!c.aemRecording);
  if (c.aemRecording) status("Recording — do your task, then Stop & save.");
  loadSkills();
});

$("save").onclick = () => { saveConn(); status("Connection saved."); loadSkills(); };
$("skill").onchange = renderFields;

$("start").onclick = async () => {
  if (!$("server").value.trim() || !$("key").value.trim()) { status("Enter your Aemulus URL and API key first."); return; }
  saveConn();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.runtime.sendMessage({ __aem: "start", startUrl: (tab && tab.url) || "", title: $("title").value.trim() }, () => {
    setRecState(true);
    $("link").style.display = "none";
    status("Recording — do your task in this tab, then Stop & save.");
  });
};

$("stop").onclick = () => {
  status("Saving…");
  chrome.runtime.sendMessage({ __aem: "stop" }, (res) => {
    setRecState(false);
    if (res && res.ok) {
      status(`Saved ${res.steps || ""} steps. Turn it into a skill on the site.`);
      showLink((res.server || "") + "/skills", "Open your recordings →");
      loadSkills();
    } else {
      status("Error: " + ((res && res.error) || "unknown"));
    }
  });
};

$("run").onclick = () => {
  const skillId = $("skill").value;
  if (!skillId) { status("Choose a skill first."); return; }
  saveConn();
  $("run").disabled = true;
  $("link").style.display = "none";
  status("Starting…");
  chrome.runtime.sendMessage({ __aem: "run", skillId, input: collectInput() });
  pollRunStatus();
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
