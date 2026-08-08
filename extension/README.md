# Aemulus Recorder (browser extension)

Records **and runs** browser tasks in your **own** browser — where you're already
logged in and look like a real user — so automation sidesteps the login re-do and
bot-detection walls a cloud browser hits. Recordings become skills on the Aemulus
site; runs execute here in your browser and report proof + a verifiable receipt
back to the site, exactly like a cloud run.

## Install (developer mode)

1. Open `chrome://extensions` (Chrome or any Chromium browser).
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this `extension/` folder.
4. Pin the **Aemulus Recorder** icon.

_(For a one-click install for everyone, see `STORE.md`.)_

## Connect it to your account

1. Click the icon.
2. **Aemulus URL** — your deployment, e.g. `https://your-app.up.railway.app`.
3. **API key** — create one on the site at **/developers → API keys** (`aem_live_…`).
4. **Save connection.**

## Record a task

1. Open the tool you want to automate (log in normally — it's your browser).
2. Extension → optionally name it → **Start recording**.
3. Do the task once (click, type, submit).
4. To watch a value, hit **Capture a value**, optionally name it, then click the
   number or status you want. The click reads that element instead of pressing
   it, and the extension shows you what it read. Without a capture a skill can
   only *do* things; a watch needs one that *reads* something.
5. While capture is on you can also set **when you care** — below a number,
   above one, equals, contains, appears, disappears, or the default "tell me
   when it changes". The rule travels with the capture, so a watch built from
   this skill starts with it already filled in instead of asking again later,
   out of context. Change it mid-capture and the next click picks up the new
   rule.
6. **Stop & save** → open **/skills** on the site → **Generalize** into a skill.

## Run a skill

Two ways, both execute in your own logged-in browser:

- **From the extension popup:** pick a skill, fill its inputs, **Run in this tab**.
- **From the site:** on your skill's page, a **"Run in your browser"** button
  appears when the extension is installed — it opens a fresh tab and runs there.

During a run: each step replays deterministically; if a selector drifted, a
server-side vision fallback (Claude) picks the element; a per-step proof
screenshot is captured; and the run settles on the site with a receipt (and pays
the creator on external runs — same rules as a cloud run). If a step can't be
resolved, the run parks in **needs review** for you to fix and retry.

## Notes

- **Secrets** (passwords, OTPs, card numbers…) are never captured or stored —
  they're recorded as empty, flagged inputs and asked for per run.
- The extension only reads/acts on a tab while you've started a recording or run.
- Keep the running tab focused; proof screenshots capture the visible tab.
- `host_permissions: <all_urls>` is required so a task can span/navigate any site.
- Regenerate icons with `node scripts/make-ext-icons.mjs`.
- Privacy policy: `PRIVACY.md`. Store submission: `STORE.md`.
