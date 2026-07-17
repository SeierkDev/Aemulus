/**
 * Next.js server-startup hook. Boots the job worker, the autonomous run
 * scheduler, and the Merkle receipt batcher once, in the Node.js runtime only
 * (skipped on edge). Dynamic import keeps their Node deps out of the edge bundle.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast on a missing/weak prod secret rather than mid-request later.
    const { env } = await import("./lib/env");
    env.validateAtBoot();
    const { startJobWorker } = await import("./lib/worker");
    startJobWorker();
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
    const { startBatcher } = await import("./lib/receipt-batch");
    startBatcher();
    const { startApActivity } = await import("./lib/ap-controls/activity");
    startApActivity();
  }
}
