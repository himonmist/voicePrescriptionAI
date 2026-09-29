import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin } from "@/lib/security/origin";
import { getActor } from "@/server/auth/current-actor";
import { verificationService } from "@/server/doctors";
import { errorResponse } from "@/lib/http";

const body = z.object({ to: z.enum(["under_review", "approved", "rejected", "active", "suspended"]), notes: z.string().trim().max(2000).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid input" }, { status: 422 });
  try {
    await verificationService().decide(id, parsed.data.to, actor, parsed.data.notes);
    return NextResponse.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
