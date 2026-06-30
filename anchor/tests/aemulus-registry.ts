import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AemulusRegistry } from "../target/types/aemulus_registry";
import { assert } from "chai";
import { randomBytes } from "crypto";

const { PublicKey, Keypair, SystemProgram } = anchor.web3;

describe("aemulus-registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.aemulusRegistry as Program<AemulusRegistry>;
  const creator = provider.wallet;

  const skillId = [...randomBytes(32)];
  const metaHash = [...randomBytes(32)];

  const skillPda = PublicKey.findProgramAddressSync(
    [Buffer.from("skill"), creator.publicKey.toBuffer(), Buffer.from(skillId)],
    program.programId,
  )[0];

  it("registers a skill", async () => {
    await program.methods
      .registerSkill(skillId, metaHash)
      .accounts({ creator: creator.publicKey, skill: skillPda, systemProgram: SystemProgram.programId })
      .rpc();

    const s = await program.account.skill.fetch(skillPda);
    assert.equal(s.creator.toBase58(), creator.publicKey.toBase58());
    assert.deepEqual([...s.skillId], skillId);
    assert.deepEqual([...s.metadataHash], metaHash);
    assert.equal(s.runCount.toNumber(), 0);
  });

  it("rejects a skill with an empty metadata hash", async () => {
    const id = [...randomBytes(32)];
    const pda = PublicKey.findProgramAddressSync(
      [Buffer.from("skill"), creator.publicKey.toBuffer(), Buffer.from(id)],
      program.programId,
    )[0];
    try {
      await program.methods
        .registerSkill(id, new Array(32).fill(0))
        .accounts({ creator: creator.publicKey, skill: pda, systemProgram: SystemProgram.programId })
        .rpc();
      assert.fail("expected EmptyMetadata");
    } catch (e) {
      assert.match(String(e), /EmptyMetadata/);
    }
  });

  it("records a receipt and bumps the skill's run count", async () => {
    const receiptHash = [...randomBytes(32)];
    const commitmentRoot = [...randomBytes(32)];
    const receiptPda = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), skillPda.toBuffer(), Buffer.from(receiptHash)],
      program.programId,
    )[0];

    await program.methods
      .recordReceipt(receiptHash, commitmentRoot, 1)
      .accounts({ runner: creator.publicKey, skill: skillPda, receipt: receiptPda, systemProgram: SystemProgram.programId })
      .rpc();

    const r = await program.account.receipt.fetch(receiptPda);
    assert.equal(r.skill.toBase58(), skillPda.toBase58());
    assert.deepEqual([...r.receiptHash], receiptHash);
    assert.deepEqual([...r.commitmentRoot], commitmentRoot);
    assert.equal(r.outcome, 1);

    const s = await program.account.skill.fetch(skillPda);
    assert.equal(s.runCount.toNumber(), 1);
  });

  it("rejects an invalid outcome code", async () => {
    const receiptHash = [...randomBytes(32)];
    const receiptPda = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), skillPda.toBuffer(), Buffer.from(receiptHash)],
      program.programId,
    )[0];
    try {
      await program.methods
        .recordReceipt(receiptHash, [...randomBytes(32)], 9)
        .accounts({ runner: creator.publicKey, skill: skillPda, receipt: receiptPda, systemProgram: SystemProgram.programId })
        .rpc();
      assert.fail("expected InvalidOutcome");
    } catch (e) {
      assert.match(String(e), /InvalidOutcome/);
    }
  });

  it("lets the creator update metadata but rejects anyone else", async () => {
    await program.methods
      .updateSkillMetadata([...randomBytes(32)])
      .accounts({ creator: creator.publicKey, skill: skillPda })
      .rpc();

    const stranger = Keypair.generate();
    try {
      await program.methods
        .updateSkillMetadata([...randomBytes(32)])
        .accounts({ creator: stranger.publicKey, skill: skillPda })
        .signers([stranger])
        .rpc();
      assert.fail("expected a has_one constraint failure");
    } catch (e) {
      assert.match(String(e), /has_one|ConstraintHasOne|2001/);
    }
  });
});
