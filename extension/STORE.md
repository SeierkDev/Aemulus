# Chrome Web Store — submission guide

Everything needed to publish **Aemulus Recorder**. The extension already runs
today via **Load unpacked** (see README) — the store listing is only needed so
other people can install it with one click instead of dev mode.

## Listing

- **Name:** Aemulus Recorder
- **Summary (≤132 chars):** Record a browser task once, then let Aemulus repeat
  it — in your own browser, already logged in, with verifiable proof.
- **Category:** Productivity
- **Language:** English

**Detailed description:**

> Aemulus turns a repetitive browser task into a reusable skill. Record yourself
> doing it once — entering a record, filling a form, updating a tool — and
> Aemulus replays it on new inputs, right in your own browser, so it's already
> signed in and behaves like you. Every run captures step-by-step proof and a
> tamper-evident receipt.
>
> The extension connects to your own Aemulus account (you provide the URL + an
> API key). Recordings and runs live on your Aemulus server, not with anyone
> else. Passwords and other secrets are never captured.

## Single purpose (required)

Record and replay browser automations for the user's own Aemulus account.

## Permissions justification (required)

- **storage** — remember the Aemulus URL/API key and buffer a recording in
  progress.
- **tabs** — identify the active tab to record or run in, read its URL to start a
  task, navigate between pages mid-task, send each step to the content script,
  and capture the visible tab for the step screenshots the user sees in their
  own run history.
- **host access (`<all_urls>`)** — a task can span any site the user chooses and
  can navigate between pages mid-task, so the recorder/replayer must work on all
  URLs. The extension only acts while the user has started a recording or a run.

## Privacy

- **Privacy policy URL:** host `extension/PRIVACY.md` somewhere public (e.g. the
  repo's raw file, or `https://<your-domain>/privacy`) and paste that URL.
- **Data usage disclosures:** the extension handles "website content" and
  "authentication information" (the API key), used **only** to operate the user's
  own account; not sold, not shared with third parties, not used for tracking.

## Assets to prepare

- **Icon:** `icons/icon128.png` (already generated).
- **Screenshots (1280×800 or 640×400):** 3–5 shots — the popup, a recording in
  progress, a run replaying with the step counter, and a finished run's proof on
  the site.
- **Small promo tile (440×280):** optional but recommended.

## Steps

1. Zip the `extension/` folder (manifest.json at the zip root).
2. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (one-time $5 registration).
3. **New item** → upload the zip.
4. Fill in the listing (above), permissions justification, and privacy fields.
5. Submit for review (typically a few days). Test on **Load unpacked** meanwhile.

## After it's published

- Pin the extension ID; the site's "Run in your browser" button works via a
  same-origin `postMessage` relay, so no extension ID needs to be hardcoded.
- Bump `version` in `manifest.json` for each update and re-upload the zip.
