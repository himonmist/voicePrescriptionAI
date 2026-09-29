import { createHash, createPrivateKey, createPublicKey, hkdfSync, sign, verify } from "node:crypto";
import { canonicalJson } from "./content";

/**
 * Integrity seal: an Ed25519 signature by the PLATFORM over a SHA-256 of the finalized prescription.
 * It proves the stored content is unchanged since the doctor finalized it, and anyone can verify it with the
 * published public key. It is NOT a legally qualified digital signature by the doctor (that needs a licensed
 * certificate authority) — see docs/CLINICAL_SAFETY.md.
 */
function seed(): Buffer {
  const explicit = process.env.PRESCRIPTION_SIGNING_SEED;
  if (explicit) { const b = Buffer.from(explicit, "base64"); if (b.length !== 32) throw new Error("PRESCRIPTION_SIGNING_SEED must be 32 bytes, base64-encoded"); return b; }
  const k = Buffer.from(process.env.FIELD_ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return Buffer.from(hkdfSync("sha256", k, Buffer.alloc(0), "prescription-signing-v1", 32));
}
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const privateKey = () => createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed()]), format: "der", type: "pkcs8" });

export const publicKeyPem = () => createPublicKey(privateKey()).export({ type: "spki", format: "pem" }).toString();

export interface SealPayload { code: string; doctorUserId: string; patientId: string; consultationId: string; version: number; finalizedAt: string; content: unknown }
export const computeHash = (p: SealPayload) => createHash("sha256").update(canonicalJson({ v: 1, ...p })).digest("hex");
export const signHash = (hash: string) => sign(null, Buffer.from(hash), privateKey()).toString("base64");
export function verifySeal(hash: string, signatureB64: string): boolean {
  try { return verify(null, Buffer.from(hash), createPublicKey(privateKey()), Buffer.from(signatureB64, "base64")); } catch { return false; }
}
