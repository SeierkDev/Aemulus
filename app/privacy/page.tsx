import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Aemulus — Privacy Policy",
  description: "What Aemulus collects and how it is used.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6">
      <Nav />
      <main className="py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-xs text-ink-3">Last updated: July 17, 2026</p>

        <Section title="Overview">
          <p>
            This policy explains what Aemulus (the “Service”) collects, how it is used, and who it is shared with. We
            collect only what is needed to run the Service.
          </p>
        </Section>

        <Section title="What we collect">
          <p>• <b>Wallet address.</b> Your Solana public key, used to authenticate you and scope your data. We never
            receive your private keys.</p>
          <p>• <b>Invoice data.</b> Files you upload and the fields extracted from them (vendor, invoice number, date,
            amount, currency), plus the ledger and audit entries you create.</p>
          <p>• <b>Usage.</b> Sealed audit events (what was reviewed, decided, and entered) and basic operational counts
            used for tier limits.</p>
          <p>• <b>Cookies.</b> A single session cookie that keeps you signed in. We do not use third-party advertising or
            tracking cookies.</p>
        </Section>

        <Section title="How we use it">
          <p>
            To provide the Service: to read your invoices, let you review and enter them, produce a verifiable audit
            trail, and enforce access tiers. We do not sell your data.
          </p>
        </Section>

        <Section title="Who we share it with">
          <p>• <b>AI extraction provider.</b> Invoice images/PDFs you upload are sent to our model provider to read their
            fields. They are not used to train models on your behalf.</p>
          <p>• <b>Your accounting software.</b> If you connect QuickBooks Online, entered invoices are sent there at your
            direction; connection tokens are stored encrypted.</p>
          <p>• <b>Infrastructure.</b> Our database and hosting providers, and Solana RPC providers used to read on-chain
            balances for tier gating.</p>
        </Section>

        <Section title="On-chain data">
          <p>
            Solana wallet addresses, token balances, and any on-chain receipts are public blockchain data by nature and
            are not controlled by us.
          </p>
        </Section>

        <Section title="Retention">
          <p>
            The audit log is append-only and tamper-evident by design; entries are retained to preserve the integrity of
            the record. You can request deletion of your account data via the channels in the footer; some sealed records
            may be retained where required to keep the audit trail verifiable.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Sessions are signed and stored in httpOnly cookies; connection tokens are encrypted at rest; data is scoped
            per wallet so accounts cannot read each other’s records. No system is perfectly secure, and you are
            responsible for safeguarding your wallet.
          </p>
        </Section>

        <Section title="Changes and contact">
          <p>
            We may update this policy; material changes will be reflected by the “last updated” date. Questions or data
            requests can be directed to the channels listed in the site footer.
          </p>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
