import { createHash } from "node:crypto";

/**
 * Binary Merkle tree over receipt hashes, with domain separation (leaves are
 * prefixed 0x00, internal nodes 0x01) to defeat second-preimage attacks. This
 * lets us anchor a single root on-chain for a whole batch of runs, while each
 * run keeps a compact proof that anyone can verify against that root —
 * O(log n) data per run, one transaction per thousands of runs.
 *
 * Pure and deterministic: no IO, no time, no randomness.
 */

function sha256(buf: Buffer): Buffer {
  return createHash("sha256").update(buf).digest();
}

/** Hash a leaf (a 32-byte hex receipt hash) with the 0x00 domain prefix. */
function hashLeaf(hexHash: string): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(hexHash, "hex")]));
}

/** Hash two child nodes with the 0x01 domain prefix. */
function hashNode(a: Buffer, b: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x01]), a, b]));
}

export interface MerkleProof {
  /** Sibling hashes from leaf → root; `left` = sibling sits on the left. */
  siblings: { hash: string; left: boolean }[];
}

export interface MerkleTree {
  root: string;
  /** Padded levels (leaf level first, root last) used to derive proofs. */
  layers: Buffer[][];
}

/** Build a Merkle tree from leaf hashes (hex). Odd levels duplicate the last. */
export function buildMerkle(leafHashes: string[]): MerkleTree {
  if (leafHashes.length === 0) throw new Error("buildMerkle: no leaves");
  let level = leafHashes.map(hashLeaf);
  const layers: Buffer[][] = [];
  for (;;) {
    if (level.length > 1 && level.length % 2 === 1) {
      level = [...level, level[level.length - 1]]; // duplicate last (Bitcoin-style)
    }
    layers.push(level);
    if (level.length === 1) break;
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(hashNode(level[i], level[i + 1]));
    }
    level = next;
  }
  return { root: layers[layers.length - 1][0].toString("hex"), layers };
}

/** Inclusion proof for the leaf at `index`. */
export function proofForIndex(tree: MerkleTree, index: number): MerkleProof {
  const siblings: { hash: string; left: boolean }[] = [];
  let idx = index;
  for (let level = 0; level < tree.layers.length - 1; level++) {
    const nodes = tree.layers[level];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    siblings.push({ hash: nodes[siblingIdx].toString("hex"), left: isRight });
    idx = Math.floor(idx / 2);
  }
  return { siblings };
}

/** Recompute the root from a leaf hash + proof and compare to `root`. */
export function verifyProof(
  leafHash: string,
  proof: MerkleProof,
  root: string,
): boolean {
  let node = hashLeaf(leafHash);
  for (const s of proof.siblings) {
    const sib = Buffer.from(s.hash, "hex");
    node = s.left ? hashNode(sib, node) : hashNode(node, sib);
  }
  return node.toString("hex") === root;
}
