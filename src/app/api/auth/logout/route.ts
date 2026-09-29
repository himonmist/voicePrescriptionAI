import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/security/origin";
import { cookies } from "next/headers";
import { authService } from "@/server/auth";
import { SESSION_COOKIE, clearSessionCookie } from "@/lib/security/cookies";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await authService().logout(token);
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.headers.append("Set-Cookie", clearSessionCookie());
  return res;
}
