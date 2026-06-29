import { Badge, Card, Label } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";
import { ApiKeysManager } from "@/components/ApiKeysManager";
import { getSession } from "@/lib/auth";
import { listApiKeys } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Aemulus — Developers",
  description: "The open Aemulus protocol: run skills and verify receipts via API.",
};

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border bg-surface-2 px-4 py-2">
        <span className="mono text-xs text-ink-2">{title}</span>
      </div>
      <pre className="mono overflow-x-auto p-4 text-xs leading-relaxed text-ink-2">
        {code}
      </pre>
    </Card>
  );
}

const ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: "POST", path: "/api/v1/runs", desc: "Run a skill on an input" },
  { method: "GET", path: "/api/v1/runs/:id", desc: "Fetch a run + extracted output" },
  { method: "GET", path: "/api/v1/skills", desc: "Browse the published catalog" },
  { method: "GET", path: "/api/verify/:runId", desc: "Verify a receipt (public)" },
  { method: "GET", path: "/api/batch/:id/bundle", desc: "Download a proof bundle" },
];

export default async function DevelopersPage() {
  const session = await getSession();
  const keys = session ? await listApiKeys(session.pubkey) : [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6">
      <Nav />

      <section className="border-t border-border pt-14 text-center">
        <Badge>
          <span className="h-1.5 w-1.5 rounded-full bg-ink" />
          Open protocol
        </Badge>
        <h1 className="mx-auto mt-5 max-w-2xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
          Build on Aemulus
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-ink-2">
          Run skills, read their proof, and verify receipts programmatically.
          One API key, REST over HTTPS, verifiable by anyone.
        </p>
      </section>

      {/* Endpoints overview */}
      <section className="py-12">
        <Label>Endpoints</Label>
        <div className="mt-4 grid gap-2">
          {ENDPOINTS.map((e) => (
            <Card
              key={e.method + e.path}
              className="flex items-center gap-3 p-3.5 text-sm"
            >
              <span className="mono w-12 shrink-0 text-ink-3">{e.method}</span>
              <span className="mono flex-1 truncate text-ink">{e.path}</span>
              <span className="hidden text-xs text-ink-3 sm:block">{e.desc}</span>
            </Card>
          ))}
        </div>
      </section>

      {/* Quickstart */}
      <section className="border-t border-border py-12">
        <Label>Quickstart</Label>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">
          Run a skill in one request
        </h2>
        <div className="mt-6 grid gap-4">
          <CodeBlock
            title="Run a skill"
            code={`curl -X POST https://aemulus.app/api/v1/runs \\
  -H "Authorization: Bearer aem_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"skillId":"skl_…","input":{"vendor":"Acme","amount":"1499"}}'
# → { "id": "run_…", "status": "running" }`}
          />
          <CodeBlock
            title="Poll the run + read extracted output"
            code={`curl https://aemulus.app/api/v1/runs/run_… \\
  -H "Authorization: Bearer aem_live_…"
# → { "status":"completed", "output":{"total":"$42.00"}, "receiptHash":"…" }`}
          />
          <CodeBlock
            title="Verify the receipt — no key, anyone can"
            code={`curl https://aemulus.app/api/verify/run_…
# → { "matches": true, "batch": { "proofValid": true, "root": "…" } }`}
          />
        </div>
      </section>

      {/* Keys */}
      <section className="border-t border-border py-12">
        <Label>Authentication</Label>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">API keys</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          Keys authenticate as your wallet — your skills, quota, and earnings all
          apply. Send as a Bearer token.
        </p>
        <div className="mt-6">
          {session ? (
            <ApiKeysManager initial={keys} />
          ) : (
            <Card className="p-8 text-center text-sm text-ink-2">
              Connect your wallet (top right) to create API keys.
            </Card>
          )}
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
