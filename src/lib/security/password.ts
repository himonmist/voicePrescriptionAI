import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 2 ** 15, R = 8, P = 1, KEYLEN = 64;
const opts = { N, r: R, p: P, maxmem: 128 * N * R * 2 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((res, rej) => scrypt(password.normalize("NFKC"), salt, KEYLEN, opts, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algo, n, r, p, salt, key] = stored.split("$");
    if (algo !== "scrypt" || Number(n) !== N || Number(r) !== R || Number(p) !== P || !salt || !key) return false;
    const expected = Buffer.from(key, "base64");
    const actual = await derive(password, Buffer.from(salt, "base64"));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function validatePasswordPolicy(pw: string): { ok: boolean; reason?: string } {
  if (pw.length < 12) return { ok: false, reason: "Use at least 12 characters." };
  if (pw.length > 128) return { ok: false, reason: "Password too long." };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (classes < 3) return { ok: false, reason: "Mix upper, lower, digits or symbols." };
  return { ok: true };
}
