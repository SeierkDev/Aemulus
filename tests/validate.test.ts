import { describe, it, expect } from "vitest";
import {
  RunBody,
  ResolveBody,
  RecordInputBody,
  PublishBody,
  RateBody,
} from "../lib/validate";

describe("API body schemas", () => {
  it("RunBody requires skillId and typed input", () => {
    expect(RunBody.safeParse({ skillId: "skl_1" }).success).toBe(true);
    expect(
      RunBody.safeParse({ skillId: "skl_1", input: { a: "b" } }).success,
    ).toBe(true);
    expect(RunBody.safeParse({}).success).toBe(false);
    expect(RunBody.safeParse({ skillId: "s", input: { a: 5 } }).success).toBe(
      false,
    );
  });

  it("ResolveBody requires a non-negative integer stepIdx", () => {
    expect(ResolveBody.safeParse({ stepIdx: 0 }).success).toBe(true);
    expect(ResolveBody.safeParse({ stepIdx: -1 }).success).toBe(false);
    expect(ResolveBody.safeParse({ stepIdx: 1.5 }).success).toBe(false);
    expect(ResolveBody.safeParse({}).success).toBe(false);
  });

  it("RecordInputBody validates the input-event union", () => {
    expect(
      RecordInputBody.safeParse({ event: { type: "click", x: 1, y: 2 } })
        .success,
    ).toBe(true);
    expect(
      RecordInputBody.safeParse({ event: { type: "key", key: "Enter" } })
        .success,
    ).toBe(true);
    expect(
      RecordInputBody.safeParse({ event: { type: "click", x: 1 } }).success,
    ).toBe(false);
    expect(
      RecordInputBody.safeParse({ event: { type: "nope" } }).success,
    ).toBe(false);
  });

  it("PublishBody requires a boolean", () => {
    expect(PublishBody.safeParse({ published: true }).success).toBe(true);
    expect(PublishBody.safeParse({ published: "yes" }).success).toBe(false);
  });

  it("RateBody requires stars 1..5", () => {
    expect(RateBody.safeParse({ stars: 5 }).success).toBe(true);
    expect(RateBody.safeParse({ stars: 4, comment: "nice" }).success).toBe(true);
    expect(RateBody.safeParse({ stars: 0 }).success).toBe(false);
    expect(RateBody.safeParse({ stars: 6 }).success).toBe(false);
    expect(RateBody.safeParse({ stars: 3.5 }).success).toBe(false);
  });
});
