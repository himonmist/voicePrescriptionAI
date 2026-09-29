import { SignJWT, jwtVerify } from "jose";
import type { Role } from "./rbac";

export interface SessionClaims { sub: string; roles: Role[]; orgId: string | null; sid: string }

function key(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set and at least 32 characters");
  return new TextEncoder().encode(s);
}

/** Short-lived access token. `sid` links to a revocable server-side session row. */
export async function signSession(c: SessionClaims, ttlSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ roles: c.roles, orgId: c.orgId, sid: c.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.sub).setIssuedAt(now).setExpirationTime(now + ttlSeconds)
    .setIssuer("smartdoctoraid").sign(key());
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"], issuer: "smartdoctoraid" });
    return { sub: String(payload.sub), roles: payload.roles as Role[], orgId: (payload.orgId as string | null) ?? null, sid: String(payload.sid) };
  } catch {
    return null;
  }
}
