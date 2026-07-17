import { describe, it, expect } from "vitest";
import { createUser, findUserByEmail, findUserById, hashPassword, verifyPassword, AccountError } from "../../lib/ap-controls/accounts";

let n = 0;
const email = () => `user${++n}_${Date.now()}@example.com`;

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("rejects a malformed hash without throwing", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("accounts", () => {
  it("creates a user, looks it up by email and id", async () => {
    const e = email();
    const u = await createUser({ email: e.toUpperCase(), password: "password123", name: "  Jane  ", now: 1 });
    expect(u.email).toBe(e); // normalized to lowercase
    expect(u.name).toBe("Jane");
    expect(u.workspaceId).toBe(u.id); // each user is their own workspace

    const byEmail = await findUserByEmail(e);
    expect(byEmail?.id).toBe(u.id);
    expect(await verifyPassword("password123", byEmail!.passwordHash)).toBe(true);
    expect((await findUserById(u.id))?.email).toBe(e);
  });

  it("defaults the name from the email local part", async () => {
    const e = `payments_${++n}@acme.co`;
    const u = await createUser({ email: e, password: "password123", now: 1 });
    expect(u.name).toBe(e.split("@")[0]);
  });

  it("rejects a duplicate email, weak password, and invalid email", async () => {
    const e = email();
    await createUser({ email: e, password: "password123", now: 1 });
    await expect(createUser({ email: e, password: "password123", now: 1 })).rejects.toMatchObject({ code: "email_taken" });
    await expect(createUser({ email: email(), password: "short", now: 1 })).rejects.toBeInstanceOf(AccountError);
    await expect(createUser({ email: "not-an-email", password: "password123", now: 1 })).rejects.toMatchObject({ code: "invalid_email" });
  });
});
