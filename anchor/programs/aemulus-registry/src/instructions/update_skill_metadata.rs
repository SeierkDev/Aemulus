use anchor_lang::prelude::*;

use crate::errors::RegistryError;
use crate::state::Skill;

#[derive(Accounts)]
pub struct UpdateSkillMetadata<'info> {
    pub creator: Signer<'info>,
    // `has_one = creator` enforces on-chain that only the skill's creator can
    // update its metadata commitment.
    #[account(mut, has_one = creator)]
    pub skill: Account<'info, Skill>,
}

pub fn handler(ctx: Context<UpdateSkillMetadata>, metadata_hash: [u8; 32]) -> Result<()> {
    require!(metadata_hash != [0u8; 32], RegistryError::EmptyMetadata);
    ctx.accounts.skill.metadata_hash = metadata_hash;
    Ok(())
}
