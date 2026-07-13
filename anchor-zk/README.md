# aemulus-zk-receipts

ZK-**compressed** on-chain run receipts for Aemulus, built on
[Light Protocol](https://www.zkcompression.com) ZK Compression.

## Why this exists

The sibling program `../anchor/` (`aemulus-registry`) records each run's receipt
as a normal Solana PDA — correct, but it pays **rent per receipt** (~0.0016 SOL),
which doesn't scale to a receipt-per-run economy.

This program records the *same* receipt as a **compressed account**: its state
lives in a Merkle tree on the ledger and only a 128-byte **zero-knowledge
validity proof** is verified on-chain. Cost drops to **~0.000015 SOL per
receipt (~100×)**, and the ZK proof is the "real ZK" backing the verifiability
moat. The compressed account's address is derived from the receipt hash, so each
receipt maps to exactly one immutable account and can never be double-recorded.

## Instruction

`record_receipt(proof, address_tree_info, output_state_tree_index, receipt_hash,
commitment_root, outcome)` — creates one compressed `Receipt { runner,
receipt_hash, commitment_root, outcome }` via CPI into the Light System Program.

## Toolchain note

This workspace uses **anchor-lang 1.x + light-sdk 0.24** — a newer Anchor than
`../anchor/` (0.32.1), which is why it's a **separate workspace** (a single
`anchor build` can't span two Anchor major versions). The Rust compiles cleanly
under plain `cargo check`; `anchor build` additionally needs the Anchor + Solana
CLI toolchains installed locally (not available in CI here).

## Build & deploy (on your machine)

```bash
cd anchor-zk
anchor keys sync          # replace the placeholder id + CPI signer with real keys
anchor build              # emits target/idl/aemulus_zk_receipts.json (the client needs this)
anchor deploy --provider.cluster devnet
```

Then enable the gated app integration (see `.env.example`):

```
AEMULUS_ZK_PROGRAM=<deployed program id>
AEMULUS_ZK_SECRET=<base58 payer secret>
AEMULUS_ZK_RPC=https://devnet.helius-rpc.com?api-key=YOUR_KEY   # a ZK-compression RPC
AEMULUS_ZK_IDL=anchor-zk/target/idl/aemulus_zk_receipts.json
```

With all set + the IDL present, `completeRun` fire-and-forget records each
completed run's receipt as a compressed account and stores the tx sig + derived
address (shown on the run page and `/verify/<run>`).

## ⚠️ Verification status

- **Rust program**: `cargo check` clean here — the compressed-account model,
  `derive_address`, `LightAccount`, and the `LightSystemProgramCpi` invoke all
  typecheck against light-sdk 0.24.
- **TypeScript client** (`lib/zk-receipts.ts`): written to Light's official
  client guide and typechecked against the installed `@lightprotocol/stateless.js`
  + `@coral-xyz/anchor`, but the exact validity-proof / packed-tree-info / IDL
  arg shapes can only be confirmed against the built IDL on a live ZK-compression
  RPC. **Validate on devnet before mainnet.** Lines needing that check are marked
  `// DEVNET` in the client.
