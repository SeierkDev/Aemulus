/**
 * Next.js server-startup hook. Validates the boot secret (fail-fast), then starts
 * the job worker, the autonomous run scheduler, the Merkle receipt batcher, the
 * on-chain anchor reconciler, and the AP activity generator — each guarded so one
 * failing to start doesn't stop the others. Node.js runtime only (skipped on edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Fail fast on a missing/weak secret rather than mid-request later.
  const { env } = await import("./lib/env");
  env.validateAtBoot();

  const { logError } = await import("./lib/log");
  const guard = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (e) {
      logError(`boot.${name}`, e);
    }
  };

  await guard("worker", async () => (await import("./lib/worker")).startJobWorker());
  await guard("scheduler", async () => (await import("./lib/scheduler")).startScheduler());
  await guard("batcher", async () => (await import("./lib/receipt-batch")).startBatcher());
  await guard("reconciler", async () => (await import("./lib/reconcile")).startReconciler());
  await guard("ap-activity", async () => (await import("./lib/ap-controls/activity")).startApActivity());

  // Announce the live config so a launch deploy is verifiable at a glance.
  await guard("status", async () => {
    const { launchStatusLine } = await import("./lib/launch-status");
    const { logInfo } = await import("./lib/log");
    logInfo("boot", launchStatusLine());
  });
}
