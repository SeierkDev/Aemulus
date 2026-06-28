/**
 * Next.js server-startup hook. Boots the autonomous run scheduler once, in the
 * Node.js runtime only (skipped on edge). Dynamic import keeps the scheduler
 * (and its Node deps) out of the edge bundle.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
