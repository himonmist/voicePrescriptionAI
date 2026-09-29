import { describe, it, expect } from "vitest";
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/security/recovery";

describe("recovery codes", () => {
  it("generates 8 unique, well-formed codes with matching hashes", () => {
    const { plain, hashes } = generateRecoveryCodes(8);
    expect(new Set(plain).size).toBe(8);
    for (const c of plain) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(hashes).toEqual(plain.map(hashRecoveryCode));
  });
  it("hash is case/whitespace-insensitive and never equals the plaintext", () => {
    expect(hashRecoveryCode(" ABCDE-FGHJK ")).toBe(hashRecoveryCode("abcde-fghjk"));
    expect(hashRecoveryCode("abcde-fghjk")).not.toContain("abcde");
  });
});
