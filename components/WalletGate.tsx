import { AccountBar } from "./AccountBar";
import { Card } from "./ui";

/**
 * Wraps a wallet-scoped section. It ALWAYS shows the account control - "Connect
 * wallet" when signed out, and the signed-in-as chip + "Sign out" when signed in
 * - and reveals its children ONLY when signed in. So private data (API keys,
 * vault, webhooks, runs) is never shown to a logged-out viewer, and it's always
 * explicit whose account it is and how to sign out.
 *
 * `signedIn` is the server session; sign-in/out call router.refresh() (see
 * auth-context), so the server re-renders and children appear/disappear reactively.
 */
export function WalletGate({
  signedIn,
  hint,
  children,
}: {
  signedIn: boolean;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start gap-3 rounded-[var(--radius-base)] border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-2">
          {signedIn
            ? "Signed in — private to your wallet. Only you can see this; sign out to hide it."
            : hint}
        </p>
        <AccountBar />
      </div>
      {signedIn ? (
        children
      ) : (
        <Card className="p-6 text-center text-sm text-ink-3">
          Nothing here is shown until you connect your wallet.
        </Card>
      )}
    </div>
  );
}
