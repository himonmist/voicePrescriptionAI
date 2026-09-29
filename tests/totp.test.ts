import { describe, it, expect } from "vitest";
import { generateTotp, verifyTotp, generateSecret } from "@/lib/security/totp";

// RFC 6238 Appendix B test vector (SHA1, secret "12345678901234567890", 8 digits) => 94287082 at T=59
const RFC_SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp", () => {
  it("matches RFC 6238 vector", () => {
    expect(generateTotp(RFC_SECRET_B32, 59_000, 8)).toBe("94287082");
  });
  it("accepts current and adjacent window, rejects far drift", () => {
    const s = generateSecret();
    const now = 1_700_000_000_000;
    const code = generateTotp(s, now);
    expect(verifyTotp(s, code, now)).toBe(true);
    expect(verifyTotp(s, code, now + 30_000)).toBe(true);
    expect(verifyTotp(s, code, now + 120_000)).toBe(false);
  });
  it("rejects malformed codes", () => {
    expect(verifyTotp(generateSecret(), "abc", Date.now())).toBe(false);
    expect(verifyTotp(generateSecret(), "12345", Date.now())).toBe(false);
  });
});
