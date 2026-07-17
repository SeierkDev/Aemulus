import { redirect } from "next/navigation";
import { getApViewer } from "@/lib/ap-controls/ap-viewer";
import { AuthForm } from "@/components/ap/AuthForm";
import { ApWalletSignIn } from "@/components/ap/ApWalletSignIn";

export const dynamic = "force-dynamic";

export default async function ApLoginPage() {
  if (await getApViewer()) redirect("/ap/queue");
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <AuthForm />
        <div className="my-6 flex items-center gap-3 text-xs text-ink-3">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>
        <ApWalletSignIn />
      </div>
    </div>
  );
}
