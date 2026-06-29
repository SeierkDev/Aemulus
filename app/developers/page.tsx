import { Badge, Card, Label } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";
import { ApiKeysManager } from "@/components/ApiKeysManager";
import { WebhooksManager } from "@/components/WebhooksManager";
import { getSession } from "@/lib/auth";
import { listApiKeys } from "@/lib/api-keys";
import { listWebhooks } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Aemulus - Developers",
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
  const webhooks = session ? await listWebhooks(session.pubkey) : [];

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
        <div className="flex items-center justify-between">
          <Label>Endpoints</Label>
          <a
            href="/api/openapi.json"
            className="text-xs text-ink-2 hover:text-ink"
          >
            OpenAPI spec ↗
          </a>
        </div>
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
            title="Verify the receipt - no key, anyone can"
            code={`curl https://aemulus.app/api/verify/run_…
# → { "matches": true, "batch": { "proofValid": true, "root": "…" } }`}
          />
        </div>
      </section>

      {/* SDK */}
      <section className="border-t border-border py-12">
        <Label>TypeScript SDK</Label>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">
          Or skip the curl
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          A tiny, dependency-free client lives in the Aemulus repo (
          <span className="mono">sdk/</span>). Works anywhere{" "}
          <span className="mono">fetch</span> does - Node, browsers, Deno, edge.
        </p>
        <div className="mt-6">
          <CodeBlock
            title="sdk/ - run, read output, verify"
            code={`import { Aemulus } from "aemulus/sdk";

const aemulus = new Aemulus({ apiKey: process.env.AEMULUS_KEY! });

// run across one input - or loop a CSV for the next hundred
const run = await aemulus.runAndWait("skl_…", { vendor: "Acme", amount: "1499" });
console.log(run.status);   // "completed"
console.log(run.output);   // { total: "$42.00" }

// anyone can verify the receipt - no key
const v = await aemulus.verify(run.id);
console.log(v.batch?.proofValid);  // true`}
          />
        </div>
      </section>

      {/* MCP */}
      <section className="border-t border-border py-12">
        <Label>MCP server</Label>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">
          Give your agent verifiable hands
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          Aemulus is a Model Context Protocol server - point any MCP client
          (Claude, your agent) at it and the marketplace becomes callable tools:{" "}
          <span className="mono">list_skills</span>,{" "}
          <span className="mono">run_skill</span>,{" "}
          <span className="mono">get_run</span>,{" "}
          <span className="mono">verify_receipt</span>. The agent runs real
          browser tasks and gets back proof.
        </p>
        <div className="mt-6">
          <CodeBlock
            title="MCP client config"
            code={`{
  "mcpServers": {
    "aemulus": {
      "url": "https://aemulus.app/api/mcp",
      "headers": { "Authorization": "Bearer aem_live_…" }
    }
  }
}`}
          />
        </div>
      </section>

      {/* Keys */}
      <section className="border-t border-border py-12">
        <Label>Authentication</Label>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">API keys</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          Keys authenticate as your wallet - your skills, quota, and earnings all
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

      {/* Webhooks */}
      <section className="border-t border-border py-12">
        <Label>Webhooks</Label>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">
          Get pinged when a run finishes
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          Subscribe a URL to{" "}
          <span className="mono">run.completed</span>,{" "}
          <span className="mono">run.needs_review</span>,{" "}
          <span className="mono">run.failed</span>, or{" "}
          <span className="mono">run.output</span> (extracted results, as a data
          destination) - each HMAC-signed so you can trust it.
        </p>
        <div className="mt-6">
          <CodeBlock
            title="Verify the signature (Node)"
            code={`import { createHmac, timingSafeEqual } from "node:crypto";

// header: "t=<unix>,sha256=<hex>"  - signed payload is \`\${t}.\${rawBody}\`
const [tPart, sigPart] = req.headers["x-aemulus-signature"].split(",");
const t = tPart.slice(2), sig = sigPart.slice(7);
// reject stale/replayed deliveries (5-min tolerance)
if (Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new Error("stale");
const mac = createHmac("sha256", WHSEC).update(t + "." + rawBody).digest("hex");
const ok = timingSafeEqual(Buffer.from(sig), Buffer.from(mac));
// body → { event, runId, status, output, receiptHash, at }`}
          />
        </div>
        <div className="mt-6">
          {session ? (
            <WebhooksManager initial={webhooks} />
          ) : (
            <Card className="p-8 text-center text-sm text-ink-2">
              Connect your wallet to register webhooks.
            </Card>
          )}
        </div>
      </section>

      {/* Reference */}
      <section className="border-t border-border py-12">
        <Label>Reference</Label>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">Webhook events</h3>
            <div className="mt-3 grid gap-2">
              {[
                ["run.completed", "A run finished successfully"],
                ["run.needs_review", "A step needs human input"],
                ["run.failed", "A run errored out"],
                ["run.output", "A run captured extracted data (output destination)"],
              ].map(([ev, desc]) => (
                <Card key={ev} className="flex items-center gap-3 p-3 text-sm">
                  <span className="mono shrink-0 text-ink">{ev}</span>
                  <span className="text-xs text-ink-3">{desc}</span>
                </Card>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-3">
              Payload:{" "}
              <span className="mono">
                {"{ event, runId, skillId, status, output, receiptHash, at }"}
              </span>
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Status codes</h3>
            <div className="mt-3 grid gap-2">
              {[
                ["200", "OK"],
                ["400", "Invalid request body"],
                ["401", "Missing or invalid API key"],
                ["404", "Skill / run / batch not found"],
                ["429", "Rate limit or daily quota reached"],
              ].map(([code, desc]) => (
                <Card key={code} className="flex items-center gap-3 p-3 text-sm">
                  <span className="mono w-10 shrink-0 text-ink">{code}</span>
                  <span className="text-xs text-ink-3">{desc}</span>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
