import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Aemulus — Terms of Service",
  description: "The terms that govern your use of Aemulus.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6">
      <Nav />
      <main className="py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-xs text-ink-3">Last updated: July 17, 2026</p>

        <Section title="1. Agreement">
          <p>
            These Terms of Service govern your access to and use of Aemulus (the “Service”). By connecting a wallet or
            otherwise using the Service, you agree to these terms. If you do not agree, do not use the Service.
          </p>
        </Section>

        <Section title="2. The Service">
          <p>
            Aemulus helps you review and enter accounts-payable invoices into your accounting records and produces a
            sealed, tamper-evident audit trail of what it did. Features, limits, and integrations may change over time.
            The Service is provided on an “as is” and “as available” basis.
          </p>
        </Section>

        <Section title="3. Wallet access and $AEMU">
          <p>
            Access to the Service is authenticated with a Solana wallet (e.g. Phantom). You are solely responsible for
            your wallet, its private keys, and all activity under it. We never take custody of your keys and cannot
            recover them.
          </p>
          <p>
            $AEMU is a utility token used to gate access and unlock usage tiers within the Service. Holding $AEMU grants
            product access only. $AEMU is not an investment, a security, a share, or a promise of profit, and we make no
            representation about its value, liquidity, or future price. Nothing in the Service is financial, legal, tax,
            or investment advice.
          </p>
        </Section>

        <Section title="4. Acceptable use">
          <p>You agree not to: use the Service unlawfully; upload content you have no right to; attempt to break, probe,
            overload, or circumvent access controls, rate limits, or the audit trail; or use the Service to process data
            you are not authorized to handle.</p>
        </Section>

        <Section title="5. Your data and content">
          <p>
            You retain ownership of the invoices and data you submit. You grant us the limited rights needed to operate
            the Service — including transmitting invoice images to our extraction provider to read their fields, and
            recording sealed audit events. The audit log is append-only by design; entries are not edited in place. See
            our <a href="/privacy" className="text-ink underline decoration-border-strong underline-offset-2 hover:opacity-80">Privacy Policy</a>.
          </p>
        </Section>

        <Section title="6. Third-party services">
          <p>
            The Service integrates with third parties you choose to use — including your accounting software (e.g.
            QuickBooks Online), the Solana network and RPC providers, and an AI model provider for invoice extraction.
            Your use of those services is governed by their own terms, and we are not responsible for them.
          </p>
        </Section>

        <Section title="7. Disclaimers">
          <p>
            The Service does not replace your professional judgment. You are responsible for reviewing what is entered
            into your accounting records. To the maximum extent permitted by law, we disclaim all warranties, express or
            implied, including merchantability, fitness for a particular purpose, and non-infringement.
          </p>
        </Section>

        <Section title="8. Limitation of liability">
          <p>
            To the maximum extent permitted by law, Aemulus and its operators will not be liable for any indirect,
            incidental, special, consequential, or punitive damages, or for any loss of profits, data, or tokens, arising
            from your use of the Service.
          </p>
        </Section>

        <Section title="9. Changes and termination">
          <p>
            We may modify or discontinue the Service, and may update these terms; continued use after changes take effect
            constitutes acceptance. We may suspend access that violates these terms.
          </p>
        </Section>

        <Section title="10. Contact">
          <p>Questions about these terms can be directed to the channels listed in the site footer.</p>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
