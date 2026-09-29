import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/security/origin";
import { authService, clientIp } from "@/server/auth";
import { landingFor } from "@/lib/security/landing";
import { sessionCookie } from "@/lib/security/cookies";

async function body(req: Request): Promise<unknown> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return req.json().catch(() => null);
  const f = await req.formData().catch(() => null);
  return f ? Object.fromEntries([...f.entries()].filter(([, v]) => v !== "")) : null;
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const r = await authService().login(await body(req), { ip: clientIp(req) });
  const wantsJson = (req.headers.get("content-type") ?? "").includes("json");
  if (!r.ok) {
    if (wantsJson) return NextResponse.json({ error: r.error, mfaRequired: r.mfaRequired ?? false }, { status: r.status });
    return NextResponse.redirect(new URL(`/login?error=${r.mfaRequired ? "mfa" : "1"}`, req.url), 303);
  }
  const res = wantsJson ? NextResponse.json({ ok: true }) : NextResponse.redirect(new URL(landingFor(r.roles, r.mfaPending), req.url), 303);
  res.headers.append("Set-Cookie", sessionCookie(r.token, r.expiresAt));
  return res;
}
