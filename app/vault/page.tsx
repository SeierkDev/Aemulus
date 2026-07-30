import { Nav } from "@/components/Nav";
import { VaultManager } from "@/components/VaultManager";
import { WalletGate } from "@/components/WalletGate";
import { getSession } from "@/lib/auth";
import { listCredentials } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const session = await getSession();
  const credentials = session ? await listCredentials(session.pubkey) : [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6">
      <Nav />
      <div className="border-t border-border pt-8">
        <h1 className="text-2xl font-semibold tracking-tight">Credential vault</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-ink-2">
          Store a site&apos;s secrets once. When you run a skill on that host,
          Aemulus fills the matching input fields from your vault - encrypted at
          rest, never shown back, and never baked into a shared skill.
        </p>

        <div className="mt-6">
          <WalletGate
            signedIn={!!session}
            hint="Connect your wallet to manage your vault - credentials are encrypted and private to your wallet."
          >
            <VaultManager initial={credentials} />
          </WalletGate>
        </div>
      </div>
      <div className="py-10" />
    </div>
  );
}
