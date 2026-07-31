# Aemulus

Record a browser task once - Aemulus learns the intent behind it and runs it autonomously, sealing cryptographic proof of every step.

[![CI](https://github.com/SeierkDev/Aemulus/actions/workflows/ci.yml/badge.svg)](https://github.com/SeierkDev/Aemulus/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Tests](https://img.shields.io/badge/tests-378%20passing-brightgreen)](#development)

[Website](https://aemulusai.com) · [Litepaper](https://aemulusai.com/litepaper) · [Developers](https://aemulusai.com/developers) · [SDK](#sdk) · [Roadmap](#roadmap)

`$AEMU · Solana` · [pump.fun](https://pump.fun/coin/7QQSvSuBenaLAUuXZtmSjMbqvupSUhCsTso3f2N9pump)

**CA** `7QQSvSuBenaLAUuXZtmSjMbqvupSUhCsTso3f2N9pump`

---

Aemulus watches you do a repetitive browser task one time, learns the *procedure* behind it, and then runs it autonomously across many cases - handling variation, capturing tamper-evident proof of every step, and stopping to ask only when it hits something genuinely new. No selectors, no scripts: if you can do it, Aemulus can learn it.

It ships with multi-demonstration program synthesis, a self-healing sandboxed browser runner, a skill marketplace with on-chain creator earnings, an accounts-payable product that reads real invoices and enters them under a cryptographically sealed audit log, a TypeScript SDK, an MCP server, and $AEMU token-gated access on Solana. Anyone can run a published skill, and anyone can independently verify a run's sealed receipt - no API key needed.

---

## Features

**Record & Generalize** - Record a task once in a real browser; Aemulus captures the trace and Claude generalizes it into a parameterized *skill* - values that vary become inputs, steps that stay become the procedure. Secrets typed during recording are redacted at capture and never leave the browser.

**Multi-Demonstration Synthesis** - Show the same task twice and a program-synthesis loop learns the procedure instead of replaying one example: a value that differs across demos is an input, a value identical across all of them is a constant. A deterministic verifier checks the skill against every demonstration and repairs contradictions until it's consistent with all of them.

**Autonomous Runs** - Skills execute in a sandboxed headless browser with a per-run egress allowlist, per-step timeouts, and a concurrency-bounded pool. Runs are durable jobs that stream live progress and settle to `completed` / `failed` / `needs_review`.

**Self-Healing** - When a recorded selector breaks, an operator model finds a working one and - optionally - an agentic fallback drives the step itself. A successful heal is written back into the skill so the next run is deterministic again.

**Sealed Audit Log** - Every run and AP invoice is an append-only, per-aggregate event stream sealed with a keyed HMAC and anchored by a keyed head, so tampering, truncation, or a seal-version downgrade is detectable - and a later legitimate append can't launder a forged chain.

**Verifiable Receipts** - Each completed run carries a Merkle-batched, on-chain-anchorable receipt plus a private selective-disclosure commitment: prove any single field of a run without revealing the rest, verifiable by anyone with no API key.

**Skill Marketplace** - Publish a skill and others can run it. Reputation (runs, success rate, ratings) is computed from real outcomes - owners can't self-inflate it - and an attributable report/takedown flow behind a moderator gate keeps the network clean.

**On-Chain Earnings** - Creators earn $AEMU each time *someone else* runs their skill, credited once per distinct adopter (anti-Sybil) and claimed as a Solana payout, with a reconciler that recovers lost-confirmation transactions.

**Accounts Payable** - Upload a PDF or image invoice; Claude extracts the fields, you confirm, and it enters into QuickBooks (or a built-in ledger) under the sealed audit log - every entry independently verifiable, with duplicate-suspicion review and a maker-checker control spine.

**Credential Vault** - Store per-host secrets once, encrypted at rest (AES-256-GCM). At run time the *runner's own* vault auto-fills matching fields, host-bound (only typed while the page is on the credential's host) and redacted from step records, screenshots, and any model prompt.

**Token Gating & Quotas** - Access tiers (Holder / Pro / Whale) derive from the wallet's live $AEMU balance; daily run quotas and AP entry caps are enforced with atomic, race-safe reservations.

**Automation** - Inbound trigger URLs, autonomous schedules (cron-style cadence), and HMAC-signed webhooks for `run.*` events - each with per-owner caps and a moderation kill-switch.

**API, SDK & MCP** - A REST API with an OpenAPI spec, a `/v1` public API, an in-repo TypeScript SDK, and an MCP server so any MCP-capable agent can run skills and verify receipts.

**Live Takeover** - When a run hits an interactive checkpoint (e.g. 2FA), it pauses and hands the live browser to the owner to finish, then resumes with the authenticated session preserved.

**Workspaces & Teams** - Every account is an isolated workspace; basic org/team roles share skills and run history, with per-workspace billing and usage metering.

---

## SDK

```ts
import { Aemulus } from "aemulus";

const aemulus = new Aemulus({ apiKey: process.env.AEMULUS_KEY! });

// Run a published skill with your inputs and wait for the result
const run = await aemulus.runAndWait("skl_…", { vendor: "Acme" });
console.log(run.output); // { total: "$42.00" }

// Anyone can verify a run's sealed receipt - no API key needed
const proof = await aemulus.verify(run.id);
```

Install with `npm i aemulus`; source in [`sdk/`](./sdk). It wraps the `/v1` REST API (also documented by the OpenAPI spec at `/api/openapi.json`).

---

## Architecture

```
app/
  api/          REST API - one file per resource (+ /v1 public API, /mcp server)
  market/       Skill marketplace UI
  runs/         Run history, live view, and rrweb replay
  ap/           Accounts-payable review product
  record/       Browser recorder
lib/            Core logic - record→generalize, synthesize, runner, seal store,
                earnings, quota, vault, webhooks, scheduler, reconcile
components/     React UI
sdk/            In-repo TypeScript SDK
anchor/         Solana program: aemulus-registry (on-chain run anchoring)
anchor-zk/      Solana program: Light-compressed ZK receipts
scripts/        rrweb vendor + QuickBooks smoke tooling
tests/          378 tests across every layer
```

Key decisions:

- Event-sourced, append-only audit log with keyed-HMAC seals + a keyed head anchor. The head is minted only by a genuine atomic append and never re-minted at runtime, so a DB-write attacker can't forge, truncate, or downgrade a chain into a "valid" record.
- libsql (Turso embedded replica in production, on-disk SQLite for local dev with no config). Every money/quota/security invariant is enforced by an atomic single-statement write, so it stays correct under concurrent writers.
- The browser runner executes as durable background jobs; the Next.js API layer never blocks on AI inference or a browser.
- Idempotency keys on mutating endpoints; sensitive routes are workspace/owner-scoped, rate-limited, and zod-validated.
- Secrets are redacted at capture, host-bound at fill, and never enter a model prompt, a step record, or a receipt.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database | libsql · Turso · SQLite |
| Browser | Playwright (headless Chromium) · rrweb |
| Chain | Solana · Anchor (Rust programs) · Light Protocol (ZK) |
| AI | Anthropic Claude (extraction · generalize · operator/agent) |
| Payments | Solana ($AEMU) · Stripe (billing) · QuickBooks (AP) |
| Testing | Vitest (378 tests) |

---

## Development

```bash
npm install          # Install dependencies
npm run dev          # Dev server at localhost:3000
npm test             # Run all 378 tests
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run build        # Production build
npm run ci           # typecheck + lint + tests (what CI runs)
```

**Configuration** - copy `.env.example` to `.env.local` and fill in what you need. The app runs fully locally against an on-disk SQLite fallback with no cloud config; `$AEMU` token gating stays off until `AEMULUS_MINT` is set, so every tier is unlimited in development.

**QuickBooks smoke test** (optional, needs a QBO sandbox in `scripts/qbo/.env.local`):

```bash
npm run qbo:smoke
```

---

## Roadmap

| Phase | Title | Status |
|---|---|---|
| 1 | Launch - $AEMU live on pump.fun, on-chain payouts, live receipt anchoring | In progress |
| 2 | Trust at scale - micro-VM sandbox per run, Arweave receipts, marketplace search | Planned |
| 3 | Deeper intelligence - vision-grounded synthesis, zk-SNARK proofs of execution | Planned |
| 4 | Open ecosystem - published SDK, skill forking, portable on-chain reputation | Planned |
| 5 | Frontier - multi-chain anchoring, on-chain skill registry, desktop/mobile capture | Planned |

Full roadmap at [aemulusai.com/roadmap](https://aemulusai.com/roadmap).

---

## License

AGPL v3. See [LICENSE](./LICENSE).

## Trademark & naming

The **code** is AGPL-3.0. The **"Aemulus" name, logo, and the "$AEMU" token are
reserved** and are *not* licensed for reuse. You may self-host and modify this
software, but you must **rebrand any public deployment** - you may not present it
as "Aemulus" or represent any token as the official $AEMU. See [NOTICE](./NOTICE).
The official project lives only at [aemulusai.com](https://aemulusai.com) and
[github.com/SeierkDev/Aemulus](https://github.com/SeierkDev/Aemulus).

Built by [SeierkDev](https://github.com/SeierkDev).
