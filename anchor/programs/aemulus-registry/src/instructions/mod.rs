pub mod record_receipt;
pub mod register_skill;
pub mod update_skill_metadata;

// Glob re-export so the #[program] macro's generated code resolves the Accounts
// structs. (This is the standard Anchor pattern; the only effect is a benign
// ambiguous-glob warning on the per-module `handler` fns, which lib.rs calls
// fully-qualified anyway.)
pub use record_receipt::*;
pub use register_skill::*;
pub use update_skill_metadata::*;
