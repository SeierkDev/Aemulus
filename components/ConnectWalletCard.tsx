"use client";

import { Button, Card } from "@/components/ui";
import { useUsageGate } from "@/components/use-usage-gate";

/**
 * Signed-out prompt with a working Connect / Sign-in button. Viewing a page is
 * open, but wallet-scoped data (earnings, your skills) needs a session — this
 * gives the visitor the action instead of a dead-end message.
 */
export function ConnectWalletCard({ message }: { message: string }) {
  const { ready, gate, label, signingIn } = useUsageGate();
  if (ready) return null;
  return (
    <Card className="mt-6 flex flex-col items-center gap-4 p-10 text-center">
      <p className="max-w-sm text-sm text-ink-2">{message}</p>
      <Button variant="primary" onClick={gate} disabled={signingIn}>
        {label}
      </Button>
    </Card>
  );
}
