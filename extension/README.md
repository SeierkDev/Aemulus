# Aemulus Recorder (browser extension)

Records a task **in your own browser** — where you're already logged in and look
like a real user — and turns it into an Aemulus skill on the site. This sidesteps
the login re-do and bot-detection walls that a cloud browser hits.

> **Phase 1: recording.** This build captures a task and posts it to the site to
> become a skill (via the existing generalize pipeline). Running skills in the
> browser is Phase 2.

## Install (developer mode)

1. Open `chrome://extensions` in Chrome (or a Chromium browser).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the **Aemulus Recorder** icon to your toolbar.

## Connect it to your account

1. Click the extension icon.
2. **Aemulus URL** — your deployment, e.g. `https://your-app.up.railway.app`.
3. **API key** — create one on the site at **/developers → API keys** (`aem_live_…`).
4. Click **Save connection**.

## Record a task

1. Go to the site/tool you want to automate (log in normally — it's your browser).
2. Click the extension → optionally name the task → **Start recording**.
3. Do the task once: click, type, submit.
4. Click **Stop & save**.
5. Click **Open your recordings →** (or go to **/skills** on the site). Your
   recording is there — hit **Generalize** to turn it into a reusable skill.

## Notes

- Passwords and other secret fields are never captured — they're recorded as
  empty, flagged inputs, so the skill asks for them per run instead of storing them.
- The extension only sends data while you're actively recording.
- `host_permissions: <all_urls>` is required so recording keeps working as you
  navigate between pages during a task.
