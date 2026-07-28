// A workspace scopes all AP data (events, ledger, QuickBooks connection) to one
// account. Each authenticated caller gets their own workspace, keyed by wallet:
// `w_<pubkey>` (see getApViewer in ap-viewer.ts). The default is used by
// unauthenticated/background paths and by tests; it never overlaps a real user's
// workspace (a literal "default" can't collide with any `w_<pubkey>` id).
export const DEFAULT_WORKSPACE = "default";
