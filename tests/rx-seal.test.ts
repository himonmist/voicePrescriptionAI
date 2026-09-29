import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { computeHash, signHash, verifySeal, publicKeyPem } from "@/server/prescriptions/seal";
import { createPublicKey, verify } from "node:crypto";

const OLD = { ...process.env };
beforeEach(() => { process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64"); delete process.env.PRESCRIPTION_SIGNING_SEED; });
afterEach(() => { process.env = { ...OLD }; });
const P = { code: "RX-ABCD2345", doctorUserId: "d1", patientId: "p1", consultationId: "c1", version: 3, finalizedAt: "2026-10-01T05:00:00.000Z", content: { items: [{ genericName: "Testalpha", dose: "1 tablet" }], advice: "Rest" } };

describe("prescription integrity seal", () => {
  it("hash is deterministic and covers every identity field and the content", () => {
    expect(computeHash(P)).toBe(computeHash({ ...P, content: { advice: "Rest", items: [{ dose: "1 tablet", genericName: "Testalpha" }] } })); // key order irrelevant
    expect(computeHash(P)).toMatch(/^[0-9a-f]{64}$/);
    for (const change of [{ code: "RX-OTHER222" }, { doctorUserId: "d2" }, { patientId: "p2" }, { version: 4 }, { finalizedAt: "2026-10-01T05:00:01.000Z" }, { content: { ...P.content, advice: "Rest more" } }])
      expect(computeHash({ ...P, ...change })).not.toBe(computeHash(P));
  });
  it("a changed dose changes the hash (silent edits are detectable)", () => {
    const edited = { ...P, content: { ...P.content, items: [{ genericName: "Testalpha", dose: "2 tablets" }] } };
    expect(computeHash(edited)).not.toBe(computeHash(P));
  });
  it("signs and verifies; rejects a signature for different content or a tampered signature", () => {
    const h = computeHash(P), s = signHash(h);
    expect(verifySeal(h, s)).toBe(true); expect(verifySeal(computeHash({ ...P, version: 9 }), s)).toBe(false);
    expect(verifySeal(h, s.slice(0, -4) + "AAAA")).toBe(false); expect(verifySeal(h, "not-base64!!")).toBe(false);
  });
  it("Ed25519 signatures can be verified independently with the published public key", () => {
    const h = computeHash(P), s = signHash(h);
    const pub = createPublicKey(publicKeyPem());
    expect(verify(null, Buffer.from(h), pub, Buffer.from(s, "base64"))).toBe(true);
  });
  it("an explicit PRESCRIPTION_SIGNING_SEED decouples the signing key from the field-encryption key", () => {
    const h = computeHash(P), viaDerived = signHash(h), pubDerived = publicKeyPem();
    process.env.PRESCRIPTION_SIGNING_SEED = Buffer.alloc(32, 99).toString("base64");
    expect(publicKeyPem()).not.toBe(pubDerived); expect(verifySeal(h, viaDerived)).toBe(false);
    expect(verifySeal(h, signHash(h))).toBe(true);
  });
  it("refuses to sign with a missing or short key", () => {
    delete process.env.FIELD_ENCRYPTION_KEY; expect(() => signHash("00")).toThrow();
    process.env.PRESCRIPTION_SIGNING_SEED = "c2hvcnQ="; expect(() => signHash("00")).toThrow(/32 bytes/);
  });
});
