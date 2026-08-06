import { logError } from "./log";

/**
 * Micro-VM isolation for a run.
 *
 * The boundary that ships today is a process boundary: each run gets its own
 * Chromium process, its own throwaway profile, and Chromium's own OS sandbox
 * (see lib/sandbox.ts). What that boundary is enforced BY is a kernel every run
 * on the box has in common — so a kernel bug is a boundary that all of them
 * share. A micro-VM removes the sharing: the run's browser executes against its
 * own kernel, and there is no common one to escape into.
 *
 * A micro-VM cannot be conjured from inside the app process. It needs hardware
 * virtualization on the host (/dev/kvm), which an ordinary container does not
 * get. So the mechanism here is a BROKER: a small service running somewhere
 * KVM-capable that boots one VM per lease, starts a browser server inside it,
 * and hands back the endpoint to connect to. The runner drives that browser
 * exactly as it drives a local one.
 *
 * Two things this module refuses to do, both deliberate:
 *
 *   1. It never reports micro-VM isolation for a run that did not get one. A
 *      broker that is down, misconfigured or absent degrades to the process
 *      boundary and the receipt says so. A receipt claiming the stronger
 *      boundary because the code supports it would be worse than no receipt.
 *   2. It never connects to an endpoint the broker did not have the authority
 *      to name. See assertLeaseEndpoint() — a broker that returns someone
 *      else's browser would be handing the run's whole session to them.
 */

export type IsolationMode = "micro-vm" | "process";

/**
 * How hard the deployment wants micro-VM isolation.
 *
 * - "off"     (default) — don't try. The process boundary is the boundary.
 * - "prefer"  — use a micro-VM when the broker gives one, fall back otherwise.
 * - "require" — a run that cannot get a micro-VM does not execute at all.
 *
 * "require" exists because "prefer" is the wrong answer for anyone who turned
 * this on for a reason. A silent downgrade under load — exactly when a broker
 * is most likely to fail — is how a deployment ends up running unisolated while
 * believing otherwise. Fail-closed is opt-in but it is a real option.
 */
export type MicrovmMode = "off" | "prefer" | "require";

export function microvmMode(): MicrovmMode {
  const raw = (process.env.AEMULUS_MICROVM ?? "").trim().toLowerCase();
  if (raw === "require") return "require";
  if (raw === "1" || raw === "prefer" || raw === "true") return "prefer";
  return "off";
}

function brokerUrl(): string {
  return (process.env.AEMULUS_MICROVM_BROKER ?? "").trim().replace(/\/+$/, "");
}

/** Is a micro-VM even reachable in principle from this deployment? */
export function microvmConfigured(): boolean {
  return microvmMode() !== "off" && brokerUrl().length > 0;
}

/** How long we wait for a VM to boot and report its browser endpoint. */
const LEASE_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.AEMULUS_MICROVM_LEASE_TIMEOUT_MS) || 45_000,
);
/** Releasing is cleanup: it gets a short leash and never blocks a run. */
const RELEASE_TIMEOUT_MS = 10_000;

export type MicrovmLease = {
  /** Broker-side id, needed to hand the VM back. */
  id: string;
  /** ws:// or wss:// endpoint of the browser server inside the VM. */
  wsEndpoint: string;
  /**
   * Whether the broker confirmed Chromium's OS sandbox is on INSIDE the VM.
   * Absent/false is recorded as false rather than assumed true — we are not the
   * ones launching that browser, so we only report what we were told.
   */
  osSandbox: boolean;
  /** Free-form kernel identifier for the run log. Never trusted for a decision. */
  kernel: string | null;
};

/**
 * Which hosts a lease may point at.
 *
 * Default: the broker's own host, and nothing else. A broker that is compromised
 * (or a plaintext broker with something in the middle) could otherwise answer a
 * lease with an endpoint it does not own, and the runner would obligingly drive
 * a browser the attacker is watching — cookies, form input, screenshots and all.
 * That is a session handover, not a misconfiguration, so the check is on by
 * default and widening it takes an explicit list.
 */
function allowedWsHosts(): string[] {
  const extra = (process.env.AEMULUS_MICROVM_WS_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const out = [...extra];
  try {
    const h = new URL(brokerUrl()).hostname.toLowerCase();
    if (h) out.push(h);
  } catch {
    /* no broker configured, or unparseable — the caller already checked */
  }
  return out;
}

/**
 * Reject an endpoint the broker had no authority to name.
 *
 * Exported for the tests: this is the check that decides whether a run's session
 * can be handed to a third party, and it is worth being able to assert on
 * directly rather than only through a live lease.
 */
export function assertLeaseEndpoint(wsEndpoint: string, allowed: string[]): void {
  let u: URL;
  try {
    u = new URL(wsEndpoint);
  } catch {
    throw new Error("micro-vm broker returned an unparseable endpoint");
  }
  if (u.protocol !== "ws:" && u.protocol !== "wss:") {
    throw new Error(`micro-vm broker returned a non-websocket endpoint (${u.protocol})`);
  }
  const host = u.hostname.toLowerCase();
  // Exact host match only. No suffix matching: "evil-broker.com" must not pass
  // because the broker happens to be "broker.com".
  if (!allowed.includes(host)) {
    throw new Error(`micro-vm broker returned an endpoint outside its own host (${host})`);
  }
}

/**
 * Refuse a plaintext broker.
 *
 * The lease request is not metadata. It carries the bearer token, and it carries
 * the outbound proxy credentials the run needs so a micro-VM run reaches sites
 * from the same IP a local one would. On http:// all of that is readable by
 * anything on the path, and the reply — which names the browser the run will be
 * driven through — is writable by it. Localhost is exempt because there is no
 * path to sit on; everything else has to be https, and the override is named so
 * nobody sets it by accident.
 */
export function assertBrokerTransport(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("AEMULUS_MICROVM_BROKER is not a valid URL");
  }
  if (u.protocol === "https:") return;
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
  if (local) return;
  if (process.env.AEMULUS_MICROVM_INSECURE === "1") return;
  throw new Error("AEMULUS_MICROVM_BROKER must be https (set AEMULUS_MICROVM_INSECURE=1 to override)");
}

function authHeaders(): Record<string, string> {
  const token = (process.env.AEMULUS_MICROVM_TOKEN ?? "").trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function brokerFetch(
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${brokerUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`micro-vm broker ${path} -> ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Shape check on the broker's answer, so a malformed reply fails here and not deep in Playwright. */
export function parseLease(raw: unknown): MicrovmLease {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const wsEndpoint = typeof o.wsEndpoint === "string" ? o.wsEndpoint : "";
  if (!id || !wsEndpoint) throw new Error("micro-vm broker returned an incomplete lease");
  return {
    id,
    wsEndpoint,
    // Strictly true-only. A broker that omits the field is telling us nothing,
    // and nothing is not a confirmation.
    osSandbox: o.osSandbox === true,
    kernel: typeof o.kernel === "string" && o.kernel ? o.kernel.slice(0, 120) : null,
  };
}

/**
 * Ask the broker for a VM.
 *
 * Returns null when the deployment isn't configured for micro-VMs, or when the
 * broker could not provide one and the mode permits going on without it. Throws
 * only in "require" mode, where not getting a VM is a reason to not run.
 *
 * The launch arguments travel with the lease because the browser is started by
 * the broker, not by us — the hardening in lib/sandbox.ts has to cross the
 * boundary with the request or it does not apply inside the VM.
 */
export async function leaseMicrovm(opts: {
  runId: string;
  args: string[];
  chromiumSandbox: boolean;
  headless: boolean;
  /** Stealth + proxy are launch-time concerns, so they have to cross with the lease. */
  stealth: boolean;
  proxy?: { server: string; username?: string; password?: string };
}): Promise<MicrovmLease | null> {
  const mode = microvmMode();
  if (mode === "off") return null;
  if (!brokerUrl()) {
    if (mode === "require") {
      throw new Error("AEMULUS_MICROVM=require but no AEMULUS_MICROVM_BROKER is set");
    }
    return null;
  }
  try {
    assertBrokerTransport(brokerUrl());
    const lease = parseLease(
      await brokerFetch(
        "/lease",
        {
          runId: opts.runId,
          args: opts.args,
          chromiumSandbox: opts.chromiumSandbox,
          headless: opts.headless,
          stealth: opts.stealth,
          ...(opts.proxy ? { proxy: opts.proxy } : {}),
        },
        LEASE_TIMEOUT_MS,
      ),
    );
    assertLeaseEndpoint(lease.wsEndpoint, allowedWsHosts());
    return lease;
  } catch (e) {
    logError("microvm.lease", e);
    if (mode === "require") {
      throw new Error(
        "micro-vm isolation is required for this deployment and none was available",
      );
    }
    return null; // prefer: the run continues behind the process boundary
  }
}

/**
 * May a run that failed to get INTO a micro-VM proceed behind the process
 * boundary instead?
 *
 * Separate from leaseMicrovm's own mode check, and not a duplicate of it. A
 * lease can succeed and the connection to the VM still fail — the VM booted,
 * the endpoint came back, and the websocket didn't open. Leaning on
 * leaseMicrovm alone to enforce require mode leaves exactly that path falling
 * back silently, which is the one thing require mode exists to prevent.
 */
export function mayRunWithoutMicrovm(): boolean {
  return microvmMode() !== "require";
}

/**
 * Hand the VM back so it can be destroyed.
 *
 * Never throws. A run that finished correctly must not be reported as failed
 * because cleanup was slow, and a broker that loses a release still reaps the
 * VM on its own lease timeout — this is the fast path, not the only one.
 */
export async function releaseMicrovm(lease: MicrovmLease | null): Promise<void> {
  if (!lease) return;
  try {
    await brokerFetch("/release", { id: lease.id }, RELEASE_TIMEOUT_MS);
  } catch (e) {
    logError("microvm.release", e);
  }
}
