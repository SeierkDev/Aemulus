use anchor_lang::prelude::*;

use crate::errors::RegistryError;
use crate::state::{Receipt, Skill};

#[derive(Accounts)]
#[instruction(receipt_hash: [u8; 32])]
pub struct RecordReceipt<'info> {
    #[account(mut)]
    pub runner: Signer<'info>,
    #[account(mut)]
    pub skill: Account<'info, Skill>,
    #[account(
        init,
        payer = runner,
        space = 8 + Receipt::INIT_SPACE,
        seeds = [Receipt::SEED, skill.key().as_ref(), receipt_hash.as_ref()],
        bump
    )]
    pub receipt: Account<'info, Receipt>,
    pub system_program: Program<'info, System>,
}

/// Anyone may anchor a receipt for a run they performed (runs are open, like the
/// off-chain product). The (skill, receipt_hash) PDA makes each receipt unique,
/// so the same receipt can't be anchored twice.
pub fn handler(
    ctx: Context<RecordReceipt>,
    receipt_hash: [u8; 32],
    commitment_root: [u8; 32],
    outcome: u8,
) -> Result<()> {
    require!(outcome <= 2, RegistryError::InvalidOutcome);

    let receipt = &mut ctx.accounts.receipt;
    receipt.skill = ctx.accounts.skill.key();
    receipt.runner = ctx.accounts.runner.key();
    receipt.receipt_hash = receipt_hash;
    receipt.commitment_root = commitment_root;
    receipt.outcome = outcome;
    receipt.created_at = Clock::get()?.unix_timestamp;
    receipt.bump = ctx.bumps.receipt;

    let skill = &mut ctx.accounts.skill;
    skill.run_count = skill.run_count.saturating_add(1);
    Ok(())
}
