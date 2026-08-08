import Link from "next/link";
import { Badge, Card, Label } from "@/components/ui";
import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";
import { ApiKeysManager } from "@/components/ApiKeysManager";
import { WebhooksManager } from "@/components/WebhooksManager";
import { WalletGate } from "@/components/WalletGate";
import { getSession } from "@/lib/auth";
import { listApiKeys } from "@/lib/api-keys";
import { listWebhooks } from "@/lib/webhooks";
import { publicBaseUrl } from "@/lib/public-url";

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

/** A numbered step in the SDK install guide. */
function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <span className="mono mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface-2 text-xs text-ink-2">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <div className="mt-2 text-sm leading-relaxed text-ink-2">{children}</div>
      </div>
    </div>
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
  const base = publicBaseUrl();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
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
            code={`curl -X POST ${base}/api/v1/runs \\
  -H "Authorization: Bearer aem_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"skillId":"skl_…","input":{"vendor":"Acme","amount":"1499"}}'
# → { "id": "run_…", "status": "running" }`}
          />
          <CodeBlock
            title="Poll the run + read extracted output"
            code={`curl ${base}/api/v1/runs/run_… \\
  -H "Authorization: Bearer aem_live_…"
# → { "status":"completed", "output":{"total":"$42.00"}, "receiptHash":"…" }`}
          />
          <CodeBlock
            title="Verify the receipt - no key, anyone can"
            code={`curl ${base}/api/verify/run_…
# → { "matches": true, "batch": { "proofValid": true, "root": "…" } }`}
          />
        </div>
      </section>

      {/* SDK */}
      <section id="sdk" className="scroll-mt-8 border-t border-border py-12">
        <Label>TypeScript SDK</Label>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">
          Install the SDK
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          A tiny, dependency-free client for the Aemulus protocol. Works anywhere{" "}
          <span className="mono">fetch</span> does - Node 18+, browsers, Deno, and
          edge runtimes.
        </p>

        {/* Install command, front and centre */}
        <Card className="mt-6 flex flex-col gap-3 border-border-strong p-5 sm:flex-row sm:items-center sm:justify-between">
          <code className="mono text-lg text-ink">npm install aemulus</code>
          <a
            href="https://www.npmjs.com/package/aemulus"
            target="_blank"
            rel="noopener noreferrer"
            className="mono shrink-0 text-xs text-ink-3 transition-colors hover:text-ink"
          >
            view on npm ↗
          </a>
        </Card>

        {/* Step by step */}
        <div className="mt-8 grid gap-7">
          <Step n={1} title="Get an API key">
            Connect your wallet on this page and create a key under{" "}
            <a href="#keys" className="text-ink underline decoration-border-strong underline-offset-2">
              Authentication
            </a>
            . The key authenticates as your wallet, so your skills, quota, and
            earnings all apply. Keep it server-side.
          </Step>

          <Step n={2} title="Install the package">
            <CodeBlock title="terminal" code={"npm install aemulus"} />
          </Step>

          <Step n={3} title="Create a client">
            <CodeBlock
              title="index.ts"
              code={`import { Aemulus } from "aemulus";

const aemulus = new Aemulus({ apiKey: process.env.AEMULUS_KEY! });`}
            />
          </Step>

          <Step n={4} title="Run a skill and read its output">
            Browse the{" "}
            <Link href="/market" className="text-ink underline decoration-border-strong underline-offset-2">
              marketplace
            </Link>{" "}
            for a skill id, then run it on your own inputs.{" "}
            <span className="mono">runAndWait</span> polls until the run reaches a
            terminal state.
            <div className="mt-3">
              <CodeBlock
                title="run a skill"
                code={`const run = await aemulus.runAndWait("skl_…", {
  vendor: "Acme",
  amount: "1499",
});

console.log(run.status);   // "completed"
console.log(run.output);   // { total: "$42.00" }`}
              />
            </div>
          </Step>

          <Step n={5} title="Verify the receipt">
            Every completed run is sealed. Anyone can check it, with no API key.
            <div className="mt-3">
              <CodeBlock
                title="verify"
                code={`const proof = await aemulus.verify(run.id);
console.log(proof.matches);           // true
console.log(proof.batch?.proofValid); // true
console.log(proof.sandbox);           // the isolation policy it ran under
console.log(proof.repairedSteps);     // steps the agent had to finish`}
              />
            </div>
          </Step>

          <Step n={6} title="Prove one field, and nothing else">
            Show a counterparty a single value from a run - a total, a status -
            provable against the run&apos;s on-chain anchored root, without
            handing over the rest of the run. They check it themselves, with no
            API key and no account.
            <div className="mt-3">
              <CodeBlock
                title="selective disclosure"
                code={`const d = await aemulus.disclose(run.id, "output.total");
// send d to anyone - it reveals only this field

const { valid, bound } = await aemulus.verifyDisclosure(d);
// valid: the proof holds.  bound: it belongs to that run.
// Accept only when both are true.`}
              />
            </div>
          </Step>

          <Step n={7} title="Watch a page, and do something when it moves">
            A watch is a schedule plus the rule that reads its output, created
            together. The cadence is checked against your tier before the watch
            exists - an unaffordable one is refused with the list you can
            sustain, rather than accepted and then silently skipped. A rule can
            do more than &ldquo;changed&rdquo;, and when it fires it can run
            another of your skills rather than only messaging you.
            <div className="mt-3">
              <CodeBlock
                title="watches"
                code={`const w = await aemulus.createWatch({
  skillId: "skl_…",
  cadence: "every30m",
  rule: { key: "dev_holding", op: "below", value: "5" },
  // Optional: run a skill at that moment, handed the value that fired it.
  // Metered against your daily run quota like any other run.
  action: { kind: "run_skill", skillId: "skl_exit" },
});

await aemulus.listWatches();                // value, last checked, its action
await aemulus.setWatchActive(w.id, false);  // pause, keeps its history
await aemulus.clearWatchAction(w.id);       // stop it running the skill
await aemulus.deleteWatch(w.id);`}
              />
            </div>
          </Step>

          <Step n={8} title="Check a webhook really came from us">
            Deliveries are signed. Verify against the RAW body - a framework that
            hands you a parsed object has already destroyed the bytes that were
            signed.
            <div className="mt-3">
              <CodeBlock
                title="webhooks"
                code={`import { verifyWebhook } from "aemulus";

const ok = await verifyWebhook({
  secret,                                   // from your webhook settings
  signature: req.headers["x-aemulus-signature"],
  body: rawBody,                            // not JSON.parse'd
});
if (!ok) return res.status(400).end();`}
              />
            </div>
          </Step>
        </div>

        <p className="mt-8 text-sm text-ink-2">
          Full method reference on{" "}
          <a
            href="https://www.npmjs.com/package/aemulus"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink underline decoration-border-strong underline-offset-2"
          >
            npm
          </a>
          , source in{" "}
          <a
            href="https://github.com/SeierkDev/Aemulus/tree/main/sdk"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink underline decoration-border-strong underline-offset-2"
          >
            the repo
          </a>
          .
        </p>
      </section>

      {/* MCP */}
      {/* Public and anchor-linkable on purpose: an interop claim is worth nothing
          if the other protocol's authors cannot check the method for themselves. */}
      <section id="agenc" className="scroll-mt-8 border-t border-border py-12">
        <Label>AgenC interop</Label>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">
          Every run carries an AgenC constraint hash
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          Computed with{" "}
          <a
            href="https://github.com/tetsuo-ai/AgenC"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink underline underline-offset-4"
          >
            AgenC&apos;s own SDK
          </a>{" "}
          (<span className="mono">@tetsuo-ai/sdk</span>, pinned to 1.4.0), folded
          into the run&apos;s receipt so it is sealed rather than stored in a column
          that could be edited, and shown on the public verify page for any run
          that has one.
        </p>

        <p className="mt-4 max-w-2xl text-sm text-ink-2">
          Their circuit takes exactly four field elements, so the layout is fixed
          and ordered. Each is a domain-separated sha256 reduced into the BN254
          scalar field:
        </p>

        <CodeBlock
          title="The four elements"
          code={`0  run       sha256("aemulus:run:"     + runId)
1  skill     sha256("aemulus:skill:"   + skillId + "@" + version)
2  outputs   sha256("aemulus:outputs:" + canonicalJson(outputs))
3  outcome   sha256("aemulus:outcome:" + status + "/" + outcomeVerdict)

// canonicalJson sorts keys, so two encoders agree.
// Each element is taken modulo the BN254 scalar field.`}
        />

        <CodeBlock
          title="Recompute it yourself"
          code={`import { computeConstraintHash } from "@tetsuo-ai/sdk";

const hash = computeConstraintHash(vector).toString(16);
// matches the constraint hash shown on /verify/<runId>`}
        />

        <p className="mt-6 max-w-2xl text-sm text-ink-2">
          Element 2 digests the run&apos;s outputs, and those are private. So the
          hash commits to a result without publishing it: whoever holds the run
          can recompute this number and see it match, and everyone else learns
          nothing from it. RISC Zero proofs verified on-chain by AgenC&apos;s router
          are the next step, and land when their prover is live.
        </p>
      </section>

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
      "url": "${base}/api/mcp",
      "headers": { "Authorization": "Bearer aem_live_…" }
    }
  }
}`}
          />
        </div>
      </section>

      {/* Keys */}
      <section id="keys" className="scroll-mt-8 border-t border-border py-12">
        <Label>Authentication</Label>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">API keys</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          Keys authenticate as your wallet - your skills, quota, and earnings all
          apply. Send as a Bearer token.
        </p>
        <div className="mt-6">
          <WalletGate
            signedIn={!!session}
            hint="Connect your wallet to create an API key. Keys belong to your wallet - only you can ever see them, and they're hidden the moment you sign out."
          >
            <ApiKeysManager initial={keys} />
          </WalletGate>
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
// status events → { event, runId, skillId, status, receiptHash, at }
// run.output    → { event, runId, skillId, output, at }`}
          />
        </div>
        <div className="mt-6">
          <WalletGate
            signedIn={!!session}
            hint="Connect your wallet to register webhooks - they belong to your wallet."
          >
            <WebhooksManager initial={webhooks} />
          </WalletGate>
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
              Status events:{" "}
              <span className="mono">
                {"{ event, runId, skillId, status, receiptHash, at }"}
              </span>
              . The opt-in <span className="mono">run.output</span> event carries
              the extracted data:{" "}
              <span className="mono">{"{ event, runId, skillId, output, at }"}</span>.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Status codes</h3>
            <div className="mt-3 grid gap-2">
              {[
                ["200", "OK"],
                ["400", "Invalid request body"],
                ["401", "Missing or invalid API key"],
                ["403", "Insufficient $AEMU balance or missing key scope"],
                ["404", "Skill / run / batch not found"],
                ["409", "Idempotency-Key already in progress"],
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
