import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/security/session";
import { decideAccess } from "@/lib/security/route-policy";
import { SESSION_COOKIE } from "@/lib/security/cookies";

export async function proxy(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySession(token) : null;
  const d = decideAccess(req.nextUrl.pathname, claims ? claims.roles : null);
  if (d.allow) return NextResponse.next();
  if (d.redirect) return NextResponse.redirect(new URL(d.redirect, req.url));
  return NextResponse.json({ error: d.status === 401 ? "Unauthorized" : "Forbidden" }, { status: d.status });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
