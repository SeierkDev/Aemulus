import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { storageWritable, resetStorageHealth } from "../lib/storage-health";

/**
 * The failure that hid behind a healthy-looking service.
 *
 * The image chowns /app/.data at build time and drops to a non-root user; a
 * volume mounted there at run time arrives owned by root and shadows it. Every
 * write then fails, and nothing said so: /api/health pinged only the database,
 * and the recorder reported every possible cause as one 409.
 */

describe("the storage probe", () => {
  beforeEach(() => resetStorageHealth());

  it("does a real write, not an access check", async () => {
    // access() on the parent passes in exactly the case that matters, so the
    // probe has to create, write and delete a file to mean anything.
    const src = readFileSync("lib/storage-health.ts", "utf8");
    expect(src).toMatch(/writeFile/);
    expect(src).toMatch(/unlink/);
    // Not imported at all: access() on the parent passes in exactly the case
    // that matters, so reaching for it would defeat the probe.
    expect(src).toMatch(/from "node:fs\/promises"/);
    expect(src.split("\n")[0]).not.toMatch(/access/);
  });

  it("says so when the directory is writable", async () => {
    const r = await storageWritable();
    expect(r.writable).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("caches, because health is polled and this touches disk", async () => {
    const a = await storageWritable(1_000_000);
    const b = await storageWritable(1_000_000 + 5_000);
    expect(b).toBe(a); // same object: not re-probed
    const c = await storageWritable(1_000_000 + 60_000);
    expect(c).not.toBe(a); // past the TTL: probed again
  });

  // The whole point of the reason string: EACCES here has one likely cause and
  // saying it turns a shrug into an instruction.
  it("names the mounted-volume case rather than printing an errno", () => {
    const src = readFileSync("lib/storage-health.ts", "utf8");
    expect(src).toMatch(/EACCES/);
    expect(src).toMatch(/volume mounted over \.data is owned by root/);
  });
});

describe("what the recorder says when it fails", () => {
  const route = readFileSync("app/api/record/start/route.ts", "utf8");

  // 409 means conflict. An unwritable disk, a browser that will not launch and
  // a page that never loads are not conflicts, and the code sent people looking
  // for a clash that was never there.
  it("no longer reports every failure as a conflict", () => {
    expect(route).not.toMatch(/status:\s*409/);
    expect(route).toMatch(/status:\s*500/);
  });

  it("checks storage before launching a browser, and says it plainly", () => {
    expect(route).toMatch(/storageWritable/);
    expect(route).toMatch(/status:\s*503/);
    expect(route).toMatch(/not something you did/);
  });
});

describe("the health probe", () => {
  const route = readFileSync("app/api/health/route.ts", "utf8");

  it("reports storage, not just the database", () => {
    expect(route).toMatch(/storage/);
    expect(route).toMatch(/unwritable/);
  });

  // Deliberately not folded into `ok`: a restart cannot change a volume's
  // permissions, so failing liveness would just restart-loop a container whose
  // read paths all still work.
  it("does not fail liveness on it", () => {
    expect(route).toMatch(/status: dbOk \? 200 : 503/);
  });
});
