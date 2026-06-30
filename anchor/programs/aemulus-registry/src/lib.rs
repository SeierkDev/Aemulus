use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

// Placeholder program id. Run `anchor keys sync` (or paste the keypair pubkey
// from `anchor keys list`) before building/deploying — see anchor/README.md.
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

/// On-chain registry for Aemulus: skills + immutable, verifiable run receipts.
/// Turns the off-chain "Memo anchoring" into queryable on-chain state — anyone
/// can read the chain to confirm a skill's existence/ownership and that a run
/// happened with a given receipt hash, private-commitment root, and outcome.
#[program]
pub mod aemulus_registry {
    use super::*;

    pub fn register_skill(
        ctx: Context<RegisterSkill>,
        skill_id: [u8; 32],
        metadata_hash: [u8; 32],
    ) -> Result<()> {
        instructions::register_skill::handler(ctx, skill_id, metadata_hash)
    }

    pub fn record_receipt(
        ctx: Context<RecordReceipt>,
        receipt_hash: [u8; 32],
        commitment_root: [u8; 32],
        outcome: u8,
    ) -> Result<()> {
        instructions::record_receipt::handler(ctx, receipt_hash, commitment_root, outcome)
    }

    pub fn update_skill_metadata(
        ctx: Context<UpdateSkillMetadata>,
        metadata_hash: [u8; 32],
    ) -> Result<()> {
        instructions::update_skill_metadata::handler(ctx, metadata_hash)
    }
}
