import { notFound } from "next/navigation";
import {
  seedApDemo,
  DEMO_INVOICE_ID,
  DEMO_FIXTURE,
  DEMO_ACTOR,
  OVERRIDE_REASONS,
} from "@/lib/ap-controls/demo";
import { projectInvoiceEntry } from "@/lib/ap-controls/projections";
import { loadConnection } from "@/lib/qbo/oauth";
import { ApReview } from "@/components/ap/ApReview";

export const dynamic = "force-dynamic";

export default async function ApInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (id !== DEMO_INVOICE_ID) notFound();
  await seedApDemo();
  const state = await projectInvoiceEntry(id);
  const conn = await loadConnection().catch(() => null);
  const connected = !!conn && conn.status === "connected" && !!conn.accessToken;

  return (
    <ApReview
      invoiceId={id}
      initialState={state}
      fixture={DEMO_FIXTURE}
      reasons={[...OVERRIDE_REASONS]}
      reviewer={DEMO_ACTOR.name}
      connected={connected}
    />
  );
}
