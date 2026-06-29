import { describe, it, expect } from "vitest";
import { z } from "zod";
import { readJson } from "../lib/validate";

const Schema = z.object({ name: z.string().max(5) });
const req = (body: string) =>
  new Request("http://t", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

describe("readJson", () => {
  it("returns ok+data for a valid body", async () => {
    const r = await readJson(req(JSON.stringify({ name: "ok" })), Schema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.name).toBe("ok");
  });

  it("400s on malformed JSON", async () => {
    const r = await readJson(req("{not json"), Schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(400);
  });

  it("400s on schema mismatch (too long / wrong type)", async () => {
    const long = await readJson(req(JSON.stringify({ name: "waytoolong" })), Schema);
    expect(long.ok).toBe(false);
    const wrong = await readJson(req(JSON.stringify({ name: 5 })), Schema);
    expect(wrong.ok).toBe(false);
  });
});
