import { describe, it, expect } from "vitest";
import { assertSafeUrl, isUnsafeRequestUrl } from "../lib/safe-url";

describe("assertSafeUrl (SSRF guard)", () => {
  const blocked = [
    "http://localhost",
    "http://127.0.0.1",
    "http://169.254.169.254/latest/meta-data", // cloud metadata
    "http://10.0.0.5",
    "http://192.168.1.1",
    "http://172.16.0.1",
    "http://[::1]",
    "http://0.0.0.0",
    "file:///etc/passwd",
    "ftp://example.com",
    "not a url",
  ];
  for (const u of blocked) {
    it(`blocks ${u}`, async () => {
      await expect(assertSafeUrl(u)).rejects.toThrow();
    });
  }

  it("blocks data:/blob: as navigation targets (attacker-authored, bypasses allowlist)", async () => {
    await expect(assertSafeUrl("data:text/html,<h1>hi</h1>")).rejects.toThrow();
    await expect(assertSafeUrl("blob:https://x/abc")).rejects.toThrow();
  });
});

describe("isUnsafeRequestUrl (per-request egress filter)", () => {
  it("blocks internal hosts, private IPs, and odd schemes", () => {
    for (const u of [
      "http://localhost/x",
      "http://127.0.0.1/x",
      "http://169.254.169.254/latest",
      "http://10.1.2.3/x",
      "http://192.168.0.1/x",
      "http://[::1]/x",
      "file:///etc/passwd",
      "ftp://example.com",
      "not a url",
    ]) {
      expect(isUnsafeRequestUrl(u)).toBe(true);
    }
  });

  it("allows public http(s) and inline data/blob", () => {
    for (const u of [
      "https://example.com/app.js",
      "http://cdn.example.org/style.css",
      "data:image/png;base64,AAAA",
      "blob:https://example.com/abc",
    ]) {
      expect(isUnsafeRequestUrl(u)).toBe(false);
    }
  });
});
