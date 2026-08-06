import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  assertBrokerTransport,
  assertLeaseEndpoint,
  leaseMicrovm,
  mayRunWithoutMicrovm,
  microvmConfigured,
  microvmMode,
  parseLease,
  releaseMicrovm,
} from "../lib/microvm";
import { sandboxPolicy } from "../lib/sandbox";

const ENV_KEYS = [
  "AEMULUS_MICROVM",
  "AEMULUS_MICROVM_BROKER",
  "AEMULUS_MICROVM_TOKEN",
  "AEMULUS_MICROVM_WS_HOSTS",
  "AEMULUS_MICROVM_INSECURE",
  "AEMULUS_CHROMIUM_SANDBOX",
];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("microvmMode", () => {
  it("is off unless explicitly turned on", () => {
    expect(microvmMode()).toBe("off");
    process.env.AEMULUS_MICROVM = "";
    expect(microvmMode()).toBe("off");
    process.env.AEMULUS_MICROVM = "no";
    expect(microvmMode()).toBe("off");
  });

  it("reads prefer and require", () => {
    for (const v of ["1", "prefer", "true", "PREFER"]) {
      process.env.AEMULUS_MICROVM = v;
      expect(microvmMode()).toBe("prefer");
    }
    process.env.AEMULUS_MICROVM = "require";
    expect(microvmMode()).toBe("require");
  });

  it("is not considered configured without a broker", () => {
    process.env.AEMULUS_MICROVM = "prefer";
    expect(microvmConfigured()).toBe(false);
    process.env.AEMULUS_MICROVM_BROKER = "https://vm.example.com";
    expect(microvmConfigured()).toBe(true);
  });
});

describe("assertLeaseEndpoint", () => {
  const allowed = ["vm.example.com"];

  it("accepts a websocket endpoint on an allowed host", () => {
    expect(() => assertLeaseEndpoint("wss://vm.example.com/abc", allowed)).not.toThrow();
    expect(() => assertLeaseEndpoint("ws://vm.example.com:9222/x", allowed)).not.toThrow();
  });

  it("rejects a non-websocket scheme", () => {
    expect(() => assertLeaseEndpoint("https://vm.example.com/x", allowed)).toThrow(
      /non-websocket/,
    );
    expect(() => assertLeaseEndpoint("file:///etc/passwd", allowed)).toThrow();
  });

  it("rejects an endpoint the broker does not own", () => {
    // This is the session-handover case: a broker that answers with somebody
    // else's browser would have the run typed into a page an attacker watches.
    expect(() => assertLeaseEndpoint("wss://attacker.tld/x", allowed)).toThrow(
      /outside its own host/,
    );
  });

  it("does not suffix-match", () => {
    // "notvm.example.com" and "vm.example.com.evil.tld" both end or start with
    // the allowed host as a substring; neither is the allowed host.
    expect(() => assertLeaseEndpoint("wss://notvm.example.com/x", allowed)).toThrow();
    expect(() => assertLeaseEndpoint("wss://vm.example.com.evil.tld/x", allowed)).toThrow();
  });

  it("rejects an unparseable endpoint", () => {
    expect(() => assertLeaseEndpoint("not a url", allowed)).toThrow(/unparseable/);
  });
});

describe("assertBrokerTransport", () => {
  it("accepts https", () => {
    expect(() => assertBrokerTransport("https://vm.example.com")).not.toThrow();
  });

  it("rejects plaintext to a remote host", () => {
    // The lease request carries the bearer token and the proxy credentials.
    expect(() => assertBrokerTransport("http://vm.example.com")).toThrow(/https/);
  });

  it("allows plaintext to localhost, where there is no path to sit on", () => {
    for (const u of ["http://localhost:8080", "http://127.0.0.1:8080"]) {
      expect(() => assertBrokerTransport(u)).not.toThrow();
    }
  });

  it("allows an explicit override", () => {
    process.env.AEMULUS_MICROVM_INSECURE = "1";
    expect(() => assertBrokerTransport("http://vm.example.com")).not.toThrow();
  });
});

describe("parseLease", () => {
  it("requires an id and an endpoint", () => {
    expect(() => parseLease({})).toThrow(/incomplete/);
    expect(() => parseLease({ id: "a" })).toThrow(/incomplete/);
    expect(() => parseLease({ wsEndpoint: "wss://x/y" })).toThrow(/incomplete/);
  });

  it("only believes osSandbox when it is literally true", () => {
    const base = { id: "a", wsEndpoint: "wss://vm.example.com/x" };
    expect(parseLease(base).osSandbox).toBe(false);
    expect(parseLease({ ...base, osSandbox: "true" }).osSandbox).toBe(false);
    expect(parseLease({ ...base, osSandbox: 1 }).osSandbox).toBe(false);
    expect(parseLease({ ...base, osSandbox: true }).osSandbox).toBe(true);
  });

  it("bounds the kernel string", () => {
    const long = "k".repeat(500);
    const l = parseLease({ id: "a", wsEndpoint: "wss://vm.example.com/x", kernel: long });
    expect(l.kernel).toHaveLength(120);
    expect(parseLease({ id: "a", wsEndpoint: "wss://vm.example.com/x" }).kernel).toBeNull();
  });
});

describe("leaseMicrovm", () => {
  const opts = {
    runId: "run_1",
    args: ["--disable-gpu"],
    chromiumSandbox: true,
    headless: true,
    stealth: true,
  };

  it("returns null when micro-VMs are off", async () => {
    process.env.AEMULUS_MICROVM_BROKER = "https://vm.example.com";
    await expect(leaseMicrovm(opts)).resolves.toBeNull();
  });

  it("returns null when preferred but unconfigured", async () => {
    process.env.AEMULUS_MICROVM = "prefer";
    await expect(leaseMicrovm(opts)).resolves.toBeNull();
  });

  it("throws when required but unconfigured", async () => {
    // The whole point of require mode: not getting the boundary is a reason not
    // to run, rather than something to discover later in a receipt.
    process.env.AEMULUS_MICROVM = "require";
    await expect(leaseMicrovm(opts)).rejects.toThrow(/no AEMULUS_MICROVM_BROKER/);
  });

  it("throws in require mode when the broker cannot be reached", async () => {
    process.env.AEMULUS_MICROVM = "require";
    // Port 1 on localhost: connection refused immediately, no network wait.
    process.env.AEMULUS_MICROVM_BROKER = "http://127.0.0.1:1";
    await expect(leaseMicrovm(opts)).rejects.toThrow(/required/);
  });

  it("degrades to null in prefer mode when the broker cannot be reached", async () => {
    process.env.AEMULUS_MICROVM = "prefer";
    process.env.AEMULUS_MICROVM_BROKER = "http://127.0.0.1:1";
    await expect(leaseMicrovm(opts)).resolves.toBeNull();
  });

  it("never throws on release", async () => {
    process.env.AEMULUS_MICROVM_BROKER = "http://127.0.0.1:1";
    await expect(
      releaseMicrovm({ id: "x", wsEndpoint: "wss://vm.example.com/x", osSandbox: true, kernel: null }),
    ).resolves.toBeUndefined();
    await expect(releaseMicrovm(null)).resolves.toBeUndefined();
  });
});

describe("mayRunWithoutMicrovm", () => {
  // A lease can succeed and the CONNECTION to the VM still fail. leaseMicrovm
  // returns happily in that case, so require mode has to be enforced again at
  // the connect site or it degrades silently on exactly that path.
  it("permits the process boundary unless micro-VMs are required", () => {
    expect(mayRunWithoutMicrovm()).toBe(true);
    process.env.AEMULUS_MICROVM = "prefer";
    expect(mayRunWithoutMicrovm()).toBe(true);
    process.env.AEMULUS_MICROVM = "require";
    expect(mayRunWithoutMicrovm()).toBe(false);
  });
});

describe("sandboxPolicy records the boundary that actually held", () => {
  it("defaults to the process boundary", () => {
    const p = sandboxPolicy(["example.com"]);
    expect(p.v).toBe(2);
    expect(p.isolation).toBe("process");
    expect(p.kernel).toBe("shared");
  });

  it("reports a micro-VM only when one was obtained", () => {
    const got = sandboxPolicy(["example.com"], { isolation: "micro-vm", osSandbox: true });
    expect(got.isolation).toBe("micro-vm");
    expect(got.kernel).toBe("dedicated");

    // A deployment that ASKED for a micro-VM and fell back must not read as one.
    process.env.AEMULUS_MICROVM = "prefer";
    const fell = sandboxPolicy(["example.com"], { isolation: "process", osSandbox: true });
    expect(fell.isolation).toBe("process");
    expect(fell.kernel).toBe("shared");
  });

  it("takes osSandbox from the run, not the environment, when the run knows", () => {
    // Inside a VM the browser is launched by the broker, so this process's env
    // says nothing about it. Confirmed-false must survive an env that says on.
    process.env.AEMULUS_CHROMIUM_SANDBOX = "1";
    expect(sandboxPolicy([], { isolation: "micro-vm", osSandbox: false }).osSandbox).toBe(
      false,
    );
    // and with no run-level fact, the environment is still the answer
    process.env.AEMULUS_CHROMIUM_SANDBOX = "0";
    expect(sandboxPolicy([]).osSandbox).toBe(false);
  });
});
