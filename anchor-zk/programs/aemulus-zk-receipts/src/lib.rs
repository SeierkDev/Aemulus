#![allow(unexpected_cfgs)]
#![allow(deprecated)]

//! Aemulus ZK-compressed run receipts.
//!
//! Records each completed run's verifiable receipt as a *compressed* account via
//! Light Protocol's ZK Compression. Unlike a normal PDA (see the sibling
//! `aemulus-registry` program, which pays ~0.0016 SOL rent per receipt), a
//! compressed account costs ~0.000015 SOL — ~100x cheaper — because its state
//! lives in a Merkle tree on the ledger with only a validity proof verified
//! on-chain. That makes a per-run on-chain receipt economical at scale, and the
//! validity proof is the "real ZK" backing the moat.
//!
//! The compressed account's address is derived from the receipt hash, so each
//! receipt maps to exactly one immutable compressed account and can never be
//! double-recorded.

use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    address::v2::derive_address,
    constants::ADDRESS_TREE_V2,
    cpi::{v2::CpiAccounts, CpiSigner},
    derive_light_cpi_signer,
    instruction::{PackedAddressTreeInfo, ValidityProof},
    LightDiscriminator, PackedAddressTreeInfoExt,
};

// Placeholder id — run `anchor keys sync` after `anchor build` to replace both
// this and the CPI signer below with the real deployed program id.
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod aemulus_zk_receipts {
    use super::*;
    use light_sdk::cpi::{
        v2::LightSystemProgramCpi, InvokeLightSystemProgram, LightCpiInstruction,
    };

    /// Record a completed run's receipt as a ZK-compressed account.
    ///
    /// `proof`, `address_tree_info` and `output_state_tree_index` come from the
    /// client's validity-proof request (Photon/Light RPC); the remaining fields
    /// are the run's tamper-evident receipt hash, its private-commitment root,
    /// and the outcome code (0 unverified / 1 achieved / 2 unconfirmed).
    pub fn record_receipt<'info>(
        ctx: Context<'info, RecordReceipt<'info>>,
        proof: ValidityProof,
        address_tree_info: PackedAddressTreeInfo,
        output_state_tree_index: u8,
        receipt_hash: [u8; 32],
        commitment_root: [u8; 32],
        outcome: u8,
    ) -> Result<()> {
        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.payer.as_ref(),
            ctx.remaining_accounts,
            crate::LIGHT_CPI_SIGNER,
        );

        let address_tree_pubkey = address_tree_info
            .get_tree_pubkey(&light_cpi_accounts)
            .map_err(|_| ErrorCode::AccountNotEnoughKeys)?;
        require!(
            address_tree_pubkey.to_bytes() == ADDRESS_TREE_V2,
            ReceiptError::InvalidAddressTree
        );

        // One compressed account per receipt hash — deterministic + unique.
        let (address, address_seed) = derive_address(
            &[b"receipt", receipt_hash.as_ref()],
            &address_tree_pubkey,
            &crate::ID,
        );

        let mut receipt = LightAccount::<Receipt>::new_init(
            &crate::ID,
            Some(address),
            output_state_tree_index,
        );
        receipt.runner = ctx.accounts.payer.key();
        receipt.receipt_hash = receipt_hash;
        receipt.commitment_root = commitment_root;
        receipt.outcome = outcome;

        LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
            .with_light_account(receipt)?
            .with_new_addresses(&[
                address_tree_info.into_new_address_params_assigned_packed(address_seed, Some(0)),
            ])
            .invoke(light_cpi_accounts)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct RecordReceipt<'info> {
    /// The platform runner — pays the (tiny) tx fee and is stamped as the
    /// receipt's on-chain author.
    #[account(mut)]
    pub payer: Signer<'info>,
}

/// The compressed receipt account. Declared as an `#[event]` so its layout is
/// emitted into the IDL (Light's convention for compressed-account structs).
#[event]
#[derive(Clone, Debug, Default, LightDiscriminator)]
pub struct Receipt {
    pub runner: Pubkey,
    pub receipt_hash: [u8; 32],
    pub commitment_root: [u8; 32],
    pub outcome: u8,
}

#[error_code]
pub enum ReceiptError {
    #[msg("Address tree is not the expected ADDRESS_TREE_V2")]
    InvalidAddressTree,
}
