import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, validatePasswordPolicy } from "@/lib/security/password";

describe("password hashing", () => {
  it("hashes with a unique salt and verifies", async () => {
    const a = await hashPassword("Correct-Horse-9!");
    const b = await hashPassword("Correct-Horse-9!");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Correct-Horse-9!", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
  });
  it("rejects malformed hashes without throwing", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("enforces password policy", () => {
    expect(validatePasswordPolicy("short1!").ok).toBe(false);
    expect(validatePasswordPolicy("alllowercaseletters").ok).toBe(false);
    expect(validatePasswordPolicy("Correct-Horse-9!").ok).toBe(true);
  });
});
