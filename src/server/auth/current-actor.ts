import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/security/cookies";
import type { Actor } from "@/lib/security/rbac";
import { authService } from ".";

/** Verifies the JWT AND the server-side session row (so logout/revocation take effect immediately). */
export async function getActor(): Promise<Actor | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? authService().authenticate(token) : null;
}
