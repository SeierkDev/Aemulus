# Micro-VM broker

Aemulus runs every skill behind a boundary. By default that boundary is a
process: the run gets its own Chromium, its own throwaway profile, Chromium's
own OS sandbox, and a network policy limited to the hosts the skill declared
(`lib/sandbox.ts`).

What that boundary is *enforced by* is a kernel shared with everything else on
the box. Micro-VM isolation removes the sharing — the run's browser executes
against its own kernel, so there is no common one to escape into.

## Why this is a separate service

A VM needs hardware virtualization on the host (`/dev/kvm`). An ordinary
container does not get it, so the app cannot boot one for itself no matter what
the code says. The app therefore talks to a **broker**: a small service you run
somewhere KVM-capable, which boots one VM per lease, starts a Playwright browser
server inside it, and returns the endpoint to connect to.

Check whether a host can do this at all:

```sh
ls -l /dev/kvm     # present and readable => KVM is available
```

If that file does not exist, micro-VM isolation cannot be active on that host,
and Aemulus will say so in the receipt rather than pretend otherwise.

## Turning it on

```sh
AEMULUS_MICROVM=prefer                              # or: require
AEMULUS_MICROVM_BROKER=https://vm.internal.example.com
AEMULUS_MICROVM_TOKEN=<shared secret>
```

`prefer` falls back to the process boundary when a VM is unavailable, and the
run's receipt records `isolation: "process"` when it does. `require` fails the
run instead. Pick `require` if the reason you turned this on matters — a silent
downgrade under load is how a deployment ends up unisolated while believing
otherwise.

## Protocol

Two endpoints. Both are `POST`, both take and return JSON, and both carry
`Authorization: Bearer <AEMULUS_MICROVM_TOKEN>` when a token is configured.

### `POST /lease`

The browser is launched by the broker, not by Aemulus, so everything that would
otherwise be a launch option travels with the request. Apply all of it inside
the VM, or the hardening does not cross the boundary.

```jsonc
{
  "runId": "run_9f2…",
  "args": ["--disable-dev-shm-usage", "--disable-gpu", "…"],  // apply verbatim
  "chromiumSandbox": true,   // do NOT pass --no-sandbox when true
  "headless": true,
  "stealth": true,           // launch via playwright-extra + stealth plugin
  "proxy": {                 // optional; omit when unset
    "server": "http://gate.provider.com:7777",
    "username": "…",
    "password": "…"
  }
}
```

Response:

```jsonc
{
  "id": "lease_abc",                          // required
  "wsEndpoint": "wss://vm.internal.example.com/lease_abc",  // required
  "osSandbox": true,        // only send true if Chromium's OS sandbox is really on
  "kernel": "6.1.0-fc"      // optional, informational, ≤120 chars
}
```

Rules the client enforces on the reply, so the broker should not be surprised
when a sloppy response is rejected:

- `wsEndpoint` must be `ws://` or `wss://`.
- Its host must be the broker's own host, exactly — no suffix matching — unless
  extra hosts are listed in `AEMULUS_MICROVM_WS_HOSTS`. A broker that could name
  any endpoint could hand the run's whole session (cookies, form input,
  screenshots) to whoever it named.
- `osSandbox` is believed only when it is literally `true`. Omitting it is not a
  confirmation, and it is recorded as `false`.
- The broker URL must be `https`, except on localhost. The lease request carries
  the bearer token and the proxy credentials.

### `POST /release`

```jsonc
{ "id": "lease_abc" }
```

Destroy the VM. Aemulus calls this when the run ends, including when it fails,
and ignores the result — a lost release must never fail a finished run. **Keep
your own lease timeout anyway**: this is the fast path, not the only one.

## What ends up in the receipt

The policy a run executed under is stored on the run and hashed into its
receipt (`lib/sandbox.ts`, `SandboxPolicy` v2):

```jsonc
{
  "v": 2,
  "isolation": "micro-vm",     // or "process"
  "kernel": "dedicated",       // or "shared"
  "allowedHosts": ["app.example.com"],
  "egress": "standard",
  "websockets": "allowlist",
  "osSandbox": true,
  "ephemeralProfile": true,
  "serviceWorkers": "blocked"
}
```

`isolation` is set from what the run *obtained*, never from what the deployment
*configured*. That is the whole point: a receipt is only worth something if it
describes the run that happened.
