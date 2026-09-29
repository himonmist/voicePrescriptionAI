import { randomInt } from "node:crypto";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** Human-readable patient ID, e.g. SDA-K7M2Q9XA. Uniqueness is enforced by a DB unique index (callers retry on collision). */
export const newPatientCode = () => "SDA-" + Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
