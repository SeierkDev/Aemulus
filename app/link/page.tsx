import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";
import { TelegramLink } from "@/components/TelegramLink";
import { WalletGate } from "@/components/WalletGate";
import { getSession } from "@/lib/auth";
import { BOT_HANDLE, botUrl, chatsForOwner } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Aemulus - Connect Telegram",
  description: "Link a Telegram chat to your wallet.",
};

/**
 * The site half of the Telegram link flow.
 *
 * It finishes here rather than in the bot because this is where the wallet has
 * actually signed. Telegram can tell us a chat id, and a chat id is not proof
 * of who somebody is — if a pasted address were accepted, anyone could point
 * their own chat at anyone else's wallet.
 */
export default async function LinkPage() {
  const session = await getSession();
  const chats = session ? await chatsForOwner(session.pubkey) : [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <Nav />
      <div className="mx-auto w-full max-w-3xl border-t border-border pt-8">
        <h1 className="text-2xl font-semibold tracking-tight">Connect Telegram</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-ink-2">
          Send <span className="mono">/start</span> to{" "}
          <a
            href={botUrl()}
            className="text-ink underline underline-offset-4"
            target="_blank"
            rel="noreferrer"
          >
            @{BOT_HANDLE}
          </a>{" "}
          and it will give you a code. Enter it below to connect that chat to
          this wallet. Codes last ten minutes.
        </p>

        <div className="mt-6">
          <WalletGate
            signedIn={!!session}
            hint="Connect your wallet first. The chat is linked to your wallet, so it has to be the one signing."
          >
            <TelegramLink initial={chats} />
          </WalletGate>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
