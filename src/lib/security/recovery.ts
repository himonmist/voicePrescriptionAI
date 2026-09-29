import { createHash, randomInt } from "node:crypto";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no ambiguous 0/o/1/l/i
const chunk = () => Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/** Codes are ~50 bits of entropy, so an unsalted SHA-256 is adequate (they are random, not user-chosen). */
export const hashRecoveryCode = (code: string) => createHash("sha256").update(code.trim().toLowerCase()).digest("hex");

export function generateRecoveryCodes(n = 8): { plain: string[]; hashes: string[] } {
  const plain = new Set<string>();
  while (plain.size < n) plain.add(`${chunk()}-${chunk()}`);
  const list = [...plain];
  return { plain: list, hashes: list.map(hashRecoveryCode) };
}
