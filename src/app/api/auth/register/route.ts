import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/security/origin";
import { dbRateLimiter } from "@/lib/security/rate-limit-db";
import { authService, clientIp } from "@/server/auth";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rl = await dbRateLimiter.hit(`register:${clientIp(req)}`, 5, 60 * 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  const data = await req.json().catch(() => null);
  const kind = new URL(req.url).searchParams.get("type");
  if (kind !== "doctor" && kind !== "patient") return NextResponse.json({ error: "Invalid registration type" }, { status: 400 });
  const r = kind === "doctor" ? await authService().registerDoctor(data) : await authService().registerPatient(data);
  return r.ok ? NextResponse.json({ ok: true }, { status: 201 }) : NextResponse.json({ error: r.error }, { status: r.status });
}
