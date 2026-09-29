import { describe, it, expect, beforeAll } from "vitest";
import { normalizePhone, phoneBlindIndex, normalizeName } from "@/lib/security/pii";

beforeAll(() => { process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64"); });

describe("pii helpers", () => {
  it("normalizes Bangladeshi phone formats to one canonical form", () => {
    for (const p of ["01712345678", "+8801712345678", "8801712345678", "017-1234 5678"]) expect(normalizePhone(p)).toBe("+8801712345678");
  });
  it("returns null for non-phone input", () => { expect(normalizePhone("hello")).toBeNull(); expect(normalizePhone("123")).toBeNull(); });
  it("blind index is deterministic, keyed, and does not contain the number", () => {
    const a = phoneBlindIndex("01712345678"), b = phoneBlindIndex("+8801712345678");
    expect(a).toBe(b); expect(a).toMatch(/^[0-9a-f]{64}$/); expect(a).not.toContain("1712345678");
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
    expect(phoneBlindIndex("01712345678")).not.toBe(a);
  });
  it("normalizes names for search/dup (case, spacing, punctuation, honorifics)", () => {
    expect(normalizeName("  Dr.  MD  Rahim   Uddin ")).toBe("md rahim uddin");
    expect(normalizeName("রহিম  উদ্দিন")).toBe("রহিম উদ্দিন");
  });
});
