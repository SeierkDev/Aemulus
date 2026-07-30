import { Badge, Card } from "@/components/ui";

/**
 * Home-page nudge: to run skills on the tools you log into (CRMs, dashboards…),
 * you install the browser extension so runs happen in your own already-signed-in
 * browser. Public-site skills still run without it. The store link is
 * env-configured (AEMULUS_EXTENSION_URL); until it's published we say so.
 */
export function ExtensionCallout({ storeUrl }: { storeUrl?: string }) {
  return (
    <section id="extension" className="mt-16 scroll-mt-24">
      <Card className="flex flex-col items-start gap-5 p-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <Badge>
            <span className="h-1.5 w-1.5 rounded-full bg-ink" />
            Browser extension
          </Badge>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">
            Run skills on the tools you log into
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            Automations run right in your own browser - already signed in, on your
            own connection, so there&apos;s no login to redo and no bot walls. Add
            the extension to run skills on your CRM, spreadsheets, dashboards, and
            anything else behind a login. Public-site skills run without it.
          </p>
        </div>
        {storeUrl ? (
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-[var(--radius-base)] bg-ink px-5 py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Get the extension
          </a>
        ) : (
          <span className="shrink-0 rounded-[var(--radius-base)] border border-border-strong bg-surface-2 px-5 py-2.5 text-sm text-ink-3">
            Coming to the Chrome Web Store
          </span>
        )}
      </Card>
    </section>
  );
}
