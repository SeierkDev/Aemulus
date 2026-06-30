use anchor_lang::prelude::*;

use crate::errors::RegistryError;
use crate::state::Skill;

#[derive(Accounts)]
#[instruction(skill_id: [u8; 32])]
pub struct RegisterSkill<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Skill::INIT_SPACE,
        seeds = [Skill::SEED, creator.key().as_ref(), skill_id.as_ref()],
        bump
    )]
    pub skill: Account<'info, Skill>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterSkill>,
    skill_id: [u8; 32],
    metadata_hash: [u8; 32],
) -> Result<()> {
    require!(metadata_hash != [0u8; 32], RegistryError::EmptyMetadata);

    let skill = &mut ctx.accounts.skill;
    skill.creator = ctx.accounts.creator.key();
    skill.skill_id = skill_id;
    skill.metadata_hash = metadata_hash;
    skill.run_count = 0;
    skill.created_at = Clock::get()?.unix_timestamp;
    skill.bump = ctx.bumps.skill;
    Ok(())
}
