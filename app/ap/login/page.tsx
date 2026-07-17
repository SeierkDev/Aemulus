import { redirect } from "next/navigation";
import { getApViewer } from "@/lib/ap-controls/ap-viewer";
import { ApWalletSignIn } from "@/components/ap/ApWalletSignIn";

export const dynamic = "force-dynamic";

export default async function ApLoginPage() {
  if (await getApViewer()) redirect("/ap/queue");
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-ink-3">Connect your Phantom wallet to access your AP workspace.</p>
        <div className="mt-6">
          <ApWalletSignIn />
        </div>
      </div>
    </div>
  );
}
