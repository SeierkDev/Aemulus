import { describe, expect, it } from "vitest";
import {
  buildCommitment,
  discloseField,
  verifyDisclosure,
  commitmentFields,
} from "../lib/commitment";

describe("private verifiable receipts (hiding commitment + selective disclosure)", () => {
  const fields = [
    { name: "skillId", value: "skl_1" },
    { name: "status", value: "completed" },
    { name: "input.password", value: "hunter2" },
    { name: "output.total", value: "$42.00" },
  ];

  it("discloses a field that verifies against the root, hiding the rest", () => {
    const { root, salts } = buildCommitment(fields);
    expect(root).toMatch(/^[0-9a-f]{64}$/);

    const d = discloseField(fields, salts, root, "output.total")!;
    expect(d.value).toBe("$42.00");
    expect(verifyDisclosure(root, d.field, d.value, d.salt, d.proof)).toBe(true);

    // the disclosure carries nothing about other fields' values
    const json = JSON.stringify(d);
    expect(json).not.toContain("hunter2");
  });

  it("rejects a tampered value, wrong salt, or wrong root", () => {
    const { root, salts } = buildCommitment(fields);
    const d = discloseField(fields, salts, root, "input.password")!;
    expect(verifyDisclosure(root, d.field, "wrong", d.salt, d.proof)).toBe(false);
    expect(verifyDisclosure(root, d.field, d.value, "deadbeef", d.proof)).toBe(false);
    expect(verifyDisclosure("0".repeat(64), d.field, d.value, d.salt, d.proof)).toBe(false);
  });

  it("rejects a boundary-shift forgery (leaf encoding is injective)", () => {
    // A leaf committed as (name, value) must NOT also verify under a different
    // (name, value) split of the same underlying data — otherwise an owner could
    // present a misleading field/value for the same anchored leaf.
    const f = [{ name: "input.a", value: "b c" }];
    const { root, salts } = buildCommitment(f);
    const d = discloseField(f, salts, root, "input.a")!;
    // honest disclosure verifies
    expect(verifyDisclosure(root, "input.a", "b c", d.salt, d.proof)).toBe(true);
    // shifting the space across the name/value boundary must fail
    expect(verifyDisclosure(root, "input.a b", "c", d.salt, d.proof)).toBe(false);
    expect(verifyDisclosure(root, "input.a b c", "", d.salt, d.proof)).toBe(false);
  });

  it("is hiding: the same fields commit to different roots (random salts)", () => {
    expect(buildCommitment(fields).root).not.toBe(buildCommitment(fields).root);
  });

  it("commitmentFields derives a stable field set from a run", () => {
    const f = commitmentFields({
      skillId: "skl_x",
      status: "completed",
      input: { a: "1" },
      output: { b: "2" },
    });
    expect(f).toContainEqual({ name: "input.a", value: "1" });
    expect(f).toContainEqual({ name: "output.b", value: "2" });
    expect(f).toContainEqual({ name: "skillId", value: "skl_x" });
  });
});
