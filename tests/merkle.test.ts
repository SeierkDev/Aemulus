import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildMerkle, proofForIndex, verifyProof } from "../lib/merkle";

const h = (s: string) => createHash("sha256").update(s).digest("hex");

describe("merkle", () => {
  it("every leaf proves against the root (various sizes incl. odd)", () => {
    for (const n of [1, 2, 3, 5, 8, 17]) {
      const leaves = Array.from({ length: n }, (_, i) => h(`leaf-${i}`));
      const tree = buildMerkle(leaves);
      for (let i = 0; i < n; i++) {
        const proof = proofForIndex(tree, i);
        expect(verifyProof(leaves[i], proof, tree.root)).toBe(true);
      }
    }
  });

  it("rejects a tampered leaf", () => {
    const leaves = [h("a"), h("b"), h("c"), h("d")];
    const tree = buildMerkle(leaves);
    const proof = proofForIndex(tree, 2);
    expect(verifyProof(h("c"), proof, tree.root)).toBe(true);
    expect(verifyProof(h("EVIL"), proof, tree.root)).toBe(false);
  });

  it("rejects a proof against the wrong root", () => {
    const t1 = buildMerkle([h("a"), h("b")]);
    const t2 = buildMerkle([h("a"), h("x")]);
    const proof = proofForIndex(t1, 0);
    expect(verifyProof(h("a"), proof, t2.root)).toBe(false);
  });

  it("is deterministic and order-sensitive", () => {
    expect(buildMerkle([h("a"), h("b")]).root).toBe(
      buildMerkle([h("a"), h("b")]).root,
    );
    expect(buildMerkle([h("a"), h("b")]).root).not.toBe(
      buildMerkle([h("b"), h("a")]).root,
    );
  });

  it("single-leaf tree: root verifies with an empty proof", () => {
    const tree = buildMerkle([h("only")]);
    expect(proofForIndex(tree, 0).siblings).toHaveLength(0);
    expect(verifyProof(h("only"), { siblings: [] }, tree.root)).toBe(true);
  });
});
