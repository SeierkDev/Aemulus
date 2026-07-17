// A workspace scopes all AP data (events, ledger, QuickBooks connection) to one
// account. Each user is their own workspace (workspace_id === user id). The
// default is used by unauthenticated/background paths and by tests; it never
// overlaps a real user's workspace (which is always a `usr_…` id).
export const DEFAULT_WORKSPACE = "default";
