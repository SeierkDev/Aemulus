import { redirect } from "next/navigation";
import { getApSession } from "@/lib/ap-controls/ap-session";
import { AuthForm } from "@/components/ap/AuthForm";

export const dynamic = "force-dynamic";

export default async function ApLoginPage() {
  if (await getApSession()) redirect("/ap/queue");
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 items-center justify-center px-6 py-16">
      <AuthForm />
    </div>
  );
}
