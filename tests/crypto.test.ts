import { describe, it, expect, beforeAll } from "vitest";
import { encryptField, decryptField } from "@/lib/security/crypto";

beforeAll(() => { process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64"); });

describe("field encryption (AES-256-GCM)", () => {
  it("round-trips and is non-deterministic", () => {
    const a = encryptField("secret"); const b = encryptField("secret");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("secret");
  });
  it("detects tampering", () => {
    const c = encryptField("secret");
    const bad = c.slice(0, -4) + (c.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => decryptField(bad)).toThrow();
  });
  it("requires a 32-byte key", () => {
    const k = process.env.FIELD_ENCRYPTION_KEY; process.env.FIELD_ENCRYPTION_KEY = "c2hvcnQ=";
    expect(() => encryptField("x")).toThrow();
    process.env.FIELD_ENCRYPTION_KEY = k;
  });
});
