use anchor_lang::prelude::*;

#[error_code]
pub enum RegistryError {
    #[msg("Outcome must be 0 (unknown), 1 (achieved), or 2 (unconfirmed).")]
    InvalidOutcome,
    #[msg("Metadata hash must be non-zero.")]
    EmptyMetadata,
}
