import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhook } from "../sdk/index";

/**
 * The helper exists because everyone writes this themselves and the two ways to
 * get it wrong are both silent: comparing with === leaks timing, and skipping
 * the timestamp lets a delivery captured once be replayed forever.
 *
 * These tests sign with the SAME scheme lib/webhooks.ts uses, so the client and
 * the server cannot drift apart without this failing.
 */
const SECRET = "whsec_test";
const BODY = JSON.stringify({ event: "run.completed", runId: "run_1" });

/** Byte-for-byte what lib/webhooks.ts sign() produces. */
const header = (ts: number, body = BODY, secret = SECRET) =>
  `t=${ts},sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;

const NOW = 1_800_000_000_000;
const TS = Math.floor(NOW / 1000);

describe("verifyWebhook", () => {
  it("accepts a genuine delivery", async () => {
    expect(await verifyWebhook({ secret: SECRET, signature: header(TS), body: BODY, now: NOW })).toBe(true);
  });

  it("rejects a body that changed by one character", async () => {
    const tampered = BODY.replace("run_1", "run_2");
    expect(await verifyWebhook({ secret: SECRET, signature: header(TS), body: tampered, now: NOW })).toBe(false);
  });

  it("rejects the wrong secret", async () => {
    expect(await verifyWebhook({ secret: "whsec_other", signature: header(TS), body: BODY, now: NOW })).toBe(false);
  });

  // Replay: the signature is genuine forever, so only the timestamp stops it.
  it("rejects a stale delivery", async () => {
    const old = TS - 3600;
    expect(await verifyWebhook({ secret: SECRET, signature: header(old), body: BODY, now: NOW })).toBe(false);
  });

  // The bypass that a one-sided check leaves open.
  it("rejects a timestamp from the future", async () => {
    const ahead = TS + 3600;
    expect(await verifyWebhook({ secret: SECRET, signature: header(ahead), body: BODY, now: NOW })).toBe(false);
  });

  it("accepts inside the tolerance window", async () => {
    expect(await verifyWebhook({ secret: SECRET, signature: header(TS - 120), body: BODY, now: NOW })).toBe(true);
  });

  it("rejects a malformed header instead of throwing", async () => {
    for (const bad of ["", "nonsense", "sha256=abc", `t=${TS}`, `t=${TS},sha256=zz`]) {
      expect(await verifyWebhook({ secret: SECRET, signature: bad, body: BODY, now: NOW })).toBe(false);
    }
  });

  /**
   * The commonest misuse: verifying against a re-serialised body.
   *
   * Not because key order changes — JSON.parse/stringify preserves it, which is
   * why the first version of this test was wrong — but because whitespace does
   * not survive the round trip. The signature covers bytes, and a framework
   * that hands you a parsed object has already destroyed the ones that were
   * signed. Always verify the raw body.
   */
  it("fails when the body was parsed and re-serialised", async () => {
    const raw = '{ "event": "run.completed", "runId": "run_1" }';
    const reserialised = JSON.stringify(JSON.parse(raw)); // whitespace gone
    expect(reserialised).not.toBe(raw);
    const sig = header(TS, raw);
    expect(await verifyWebhook({ secret: SECRET, signature: sig, body: reserialised, now: NOW })).toBe(false);
    // …and passes against the bytes that were actually signed.
    expect(await verifyWebhook({ secret: SECRET, signature: sig, body: raw, now: NOW })).toBe(true);
  });
});
