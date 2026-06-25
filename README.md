# Mimic

**Show it once. It does the rest.**

Mimic watches you do a repetitive browser task one time, learns the *intent*
behind it, and then runs it autonomously across many cases — handling variation,
capturing proof of every step, and stopping to ask only when it hits something
genuinely new.

It's the dream that RPA never delivered: automation for people who can't (or
shouldn't have to) code. No selectors, no scripts. If you can do it, Mimic can
learn it.

## How it works

| Stage | What happens |
|-------|--------------|
| **Record** | Do the task once in a controlled browser. Mimic captures actions + screen context. |
| **Generalize** | Claude turns that single demonstration into a reusable, parameterized *skill*. |
| **Run** | The skill executes on new inputs on its own — with per-step proof and confidence-based flagging. |

The first wedge: **structured data entry** — show it how to copy fields from a
document into a form once, and it does the next hundred.

## Why it's different

- **Knows when to stop** — per-step confidence; the weird cases get flagged for a human instead of guessed.
- **Brings receipts** — every step is captured with a screenshot. Trust by proof, not faith.
- **No brittleness** — it understands the task, so it survives layout changes that break recorded scripts.

## Stack

- **Next.js 16** (App Router) · **TypeScript** · **Tailwind v4** — monochrome design system
- **Playwright** — browser capture + autonomous execution
- **Claude** (`@anthropic-ai/sdk`) — intent generalization (Opus) + per-step operation (Sonnet)
- **Turso / libsql** — persistence (local SQLite file in dev)

## Getting started

```bash
cp .env.example .env        # add your ANTHROPIC_API_KEY
npm install
npx playwright install chromium
npm run dev                 # http://localhost:3000
```

In dev, the database is a local SQLite file at `./.data/mimic.db` — no cloud
setup required. Set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` for production.

## Project layout

```
app/          Next.js routes + monochrome UI
components/    Shared UI kit (grayscale only)
lib/          env · db (libsql) · schema · Claude client
```

## Status

Phase 0 complete: scaffold, monochrome design system, database schema, Claude
wiring. Next up: the **Record** capture loop (Phase 1).
