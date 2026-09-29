import { createHmac, hkdfSync } from "node:crypto";

/** Canonical Bangladesh mobile format: +8801XXXXXXXXX. Returns null if not a valid BD mobile. */
export function normalizePhone(input: string): string | null {
  const d = input.replace(/[\s\-()]/g, "");
  const m = d.match(/^(?:\+?88)?(01[3-9]\d{8})$/);
  return m ? `+88${m[1]}` : null;
}

function indexKey(): Buffer {
  const k = Buffer.from(process.env.FIELD_ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return Buffer.from(hkdfSync("sha256", k, Buffer.alloc(0), "phone-blind-index-v1", 32));
}

/** Keyed HMAC so phone numbers can be matched (duplicates/search) without storing them in the clear. */
export function phoneBlindIndex(phone: string): string {
  const n = normalizePhone(phone);
  if (!n) throw new Error("Invalid phone");
  return createHmac("sha256", indexKey()).update(n).digest("hex");
}

export function normalizeName(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\b(dr|mr|mrs|ms|prof)\b\.?/g, " ").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
}
