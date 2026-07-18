import { Card } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { OrgManager } from "@/components/OrgManager";
import { getSession } from "@/lib/auth";
import { listMyOrgs, listMembers } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function OrgPage() {
  const session = await getSession();
  const orgs = session ? await listMyOrgs(session.pubkey) : [];
  const me = session?.pubkey ?? ""; // orgs is empty without a session, so this is only used when authed
  const withMembers = await Promise.all(
    orgs.map(async (o) => ({ ...o, members: await listMembers(o.id, me) })),
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6">
      <Nav />
      <div className="border-t border-border pt-8">
        <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-ink-2">
          Share skills with other wallets. Members can view and run a shared
          skill; admins can edit it. Runs, earnings, and your vault stay personal.
        </p>

        <div className="mt-6">
          {session ? (
            <OrgManager initial={withMembers} me={session.pubkey} />
          ) : (
            <Card className="p-8 text-center text-sm text-ink-2">
              Connect your wallet to manage teams.
            </Card>
          )}
        </div>
      </div>
      <div className="py-10" />
    </div>
  );
}
