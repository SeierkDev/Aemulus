# Aemulus Recorder — Privacy Policy

_Last updated: 2026-07-29_

The Aemulus Recorder extension records and replays browser tasks **in your own
browser**, on your instruction, and sends the results to **your own Aemulus
account** on the Aemulus server you configure. It exists to keep automation
running as *you* — logged in, on your own connection.

## What the extension accesses

- **Page content on the tab you're recording or running** — element selectors,
  the field values you type, and a proof screenshot per step. This only happens
  **while you have explicitly started a recording or a run.** When idle, the
  extension reads nothing.
- **Your connection settings** — the Aemulus server URL and API key you enter,
  stored locally in the browser (`chrome.storage.local`) so you don't re-enter
  them. The API key is a credential for *your* account; it is never sent anywhere
  except your configured Aemulus server, as a Bearer token.

## What it sends, and to whom

- Recorded traces and run results (including proof screenshots) are sent **only
  to the Aemulus server URL you configure** — your own deployment. Nothing is
  sent to the extension author or any third party.
- On a run, when a recorded selector no longer matches, the current page's
  candidate elements and a screenshot are sent to your Aemulus server so its
  vision fallback can pick the element. Again — only to your configured server.

## What it never captures

- **Secret fields** (passwords, one-time codes, card numbers, API keys, and
  similar) are detected and **never captured or transmitted** — they're recorded
  as empty, flagged inputs so the skill asks for them per run instead.

## Storage & retention

- Settings (server URL, API key) and a transient action buffer live in your
  browser's local storage. Uninstalling the extension removes them.
- Recordings and runs are stored on your Aemulus server under your account,
  governed by that deployment — not by the extension.

## No analytics, no tracking

The extension contains no analytics, telemetry, ads, or third-party trackers. It
makes network requests only to the Aemulus server URL you configure.

## Contact

Questions: open an issue on the Aemulus repository.
