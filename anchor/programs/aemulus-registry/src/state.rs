use anchor_lang::prelude::*;

/// A skill registered on-chain by its creator. PDA: ["skill", creator, skill_id].
/// `skill_id` is the 32-byte hash of the off-chain skill id; `metadata_hash` is a
/// commitment to the skill's name/description/plan so edits are detectable.
#[account]
#[derive(InitSpace)]
pub struct Skill {
    pub creator: Pubkey,
    pub skill_id: [u8; 32],
    pub metadata_hash: [u8; 32],
    pub run_count: u64,
    pub created_at: i64,
    pub bump: u8,
}

impl Skill {
    pub const SEED: &'static [u8] = b"skill";
}

/// An immutable, on-chain receipt for a single run. PDA: ["receipt", skill,
/// receipt_hash]. Anyone can read the chain to confirm a run happened against a
/// registered skill, with its receipt hash, private-commitment root, and outcome.
#[account]
#[derive(InitSpace)]
pub struct Receipt {
    pub skill: Pubkey,
    pub runner: Pubkey,
    pub receipt_hash: [u8; 32],
    pub commitment_root: [u8; 32],
    /// 0 = unknown/unverified, 1 = goal achieved, 2 = unconfirmed.
    pub outcome: u8,
    pub created_at: i64,
    pub bump: u8,
}

impl Receipt {
    pub const SEED: &'static [u8] = b"receipt";
}
