# aemulus-registry (Solana / Anchor)

On-chain registry for Aemulus skills + verifiable run receipts. It turns the
off-chain "Memo anchoring" into queryable on-chain state: anyone can read the
chain to confirm a skill's existence + ownership and that a run happened with a
given receipt hash, private-commitment root, and outcome.

This Anchor workspace is **isolated from the Next.js app** — it has its own
Rust/TS toolchain and is excluded from the app's `tsc`/eslint/vitest. Building it
needs the Anchor CLI + a Solana wallet (not required to run the web app).

## Program

`aemulus_registry` — three instructions:

| Instruction | Who | Effect |
|---|---|---|
| `register_skill(skill_id, metadata_hash)` | creator (signer) | Creates a `Skill` PDA `["skill", creator, skill_id]` — on-chain existence + ownership + a commitment to the skill's metadata. |
| `record_receipt(receipt_hash, commitment_root, outcome)` | runner (signer) | Creates an immutable `Receipt` PDA `["receipt", skill, receipt_hash]` and bumps `skill.run_count`. The (skill, receipt_hash) seed makes each receipt unique (no double-anchor). |
| `update_skill_metadata(metadata_hash)` | creator only (`has_one`) | Updates the metadata commitment when the skill is edited. |

`skill_id`, `metadata_hash`, `receipt_hash`, and `commitment_root` are all 32-byte
hashes — the app passes `sha256` of the off-chain id / a commitment over the
skill's fields / the run's receipt digest / the run's private-commitment root.

## Build, test, deploy

Prereqs: [Rust], [Solana CLI], [Anchor CLI] (`avm install 0.32.1 && avm use 0.32.1`).

```bash
cd anchor

# 1. Generate the program keypair + sync the declared id into the source + Anchor.toml
anchor keys sync

# 2. Build (produces target/deploy/*.so + target/idl + target/types)
anchor build

# 3. Test against a local validator
anchor test

# 4. Deploy to devnet (uses [provider] wallet/cluster in Anchor.toml)
anchor deploy --provider.cluster devnet
```

The declared id in `programs/aemulus-registry/src/lib.rs` and `Anchor.toml` is a
**placeholder** — `anchor keys sync` replaces it with your generated program id
before the first build.

## Wiring it into the app (next step, gated)

The web app records receipts on-chain exactly like the existing anchoring is
gated: inert unless configured. After deploying, set the program id + a payer
keypair in the app's env and call `record_receipt` from the receipt-batch /
finalize path (alongside, or instead of, the Memo anchor). Until then the app
keeps working unchanged with off-chain receipts + Memo anchoring.

[Rust]: https://www.rust-lang.org/tools/install
[Solana CLI]: https://docs.solanalabs.com/cli/install
[Anchor CLI]: https://www.anchor-lang.com/docs/installation
