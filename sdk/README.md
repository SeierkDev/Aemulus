# aemulus

TypeScript client for the [Aemulus](https://aemulusai.com) protocol. Run browser-automation skills on your own inputs and verify their sealed receipts.

Zero dependencies. Works anywhere `fetch` exists: Node 18+, browsers, Deno, edge runtimes.

```bash
npm install aemulus
```

## Quick start

```ts
import { Aemulus } from "aemulus";

const aemulus = new Aemulus({ apiKey: process.env.AEMULUS_KEY! });

// Run a published skill and wait for the result
const run = await aemulus.runAndWait("skl_…", { vendor: "Acme", amount: "1499" });
console.log(run.status); // "completed"
console.log(run.output); // { total: "$42.00" }

// Anyone can verify a run's receipt, no API key needed
const proof = await aemulus.verify(run.id);
console.log(proof.matches); // true
```

Get an API key from the [developers page](https://aemulusai.com/developers) after connecting your wallet. Keys belong to your wallet, and only you can see them.

## API

```ts
new Aemulus({ apiKey, baseUrl? })
```

`baseUrl` defaults to `https://aemulusai.com`; override it to point at your own deployment.

| Method | Description |
|---|---|
| `run(skillId, input?, { idempotencyKey? })` | Start a run, returns immediately with status `running` |
| `runAndWait(skillId, input?, { timeoutMs?, intervalMs?, idempotencyKey? })` | Start a run and poll until it reaches a terminal state |
| `getRun(id)` | Fetch a run's current state (status, result, extracted output, receipt) |
| `listRuns({ limit?, cursor? })` | One page of your runs, newest first |
| `listSkills({ limit?, cursor? })` | One page of the published skill catalog |
| `allSkills(pageSize?)` | Walk every page of the catalog, auto-following cursors |
| `verify(runId)` | Verify a run's sealed receipt. Public, no API key required |

Pass an `idempotencyKey` so a retried request returns the original run instead of starting a second one.

### Errors

Failed calls throw `AemulusError` with a `status` field:

```ts
import { Aemulus, AemulusError } from "aemulus";

try {
  await aemulus.run("skl_…", {});
} catch (e) {
  if (e instanceof AemulusError && e.status === 429) {
    // rate limited or daily quota reached
  }
}
```

Every request is bounded by a timeout (30s default per call), so a hung connection can't block forever.

### Paging

```ts
let cursor: string | undefined;
do {
  const page = await aemulus.listRuns({ limit: 50, cursor });
  for (const run of page.runs) console.log(run.id, run.status);
  cursor = page.nextCursor ?? undefined;
} while (cursor);
```

## What is Aemulus

Record a browser task once. Aemulus learns the intent behind it, runs it autonomously on new inputs, and seals tamper-evident proof of every step. Published skills can be run by anyone, and any run's receipt can be independently verified without an API key.

Full source: [github.com/SeierkDev/Aemulus](https://github.com/SeierkDev/Aemulus)

## License

AGPL-3.0-or-later
