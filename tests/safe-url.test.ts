import { describe, it, expect } from "vitest";
import { assertSafeUrl } from "../lib/safe-url";

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

  it("allows data: URLs (inline, no network)", async () => {
    await expect(
      assertSafeUrl("data:text/html,<h1>hi</h1>"),
    ).resolves.toBeUndefined();
  });
});
