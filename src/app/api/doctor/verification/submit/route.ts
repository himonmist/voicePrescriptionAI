import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/security/origin";
import { getActor } from "@/server/auth/current-actor";
import { doctorForUser, verificationService } from "@/server/doctors";
import { errorResponse } from "@/lib/http";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!actor.roles.includes("doctor")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const doc = await doctorForUser(actor.userId); // ownership: never accept a doctor id from the client
    if (!doc) return NextResponse.json({ error: "Doctor profile not found" }, { status: 404 });
    await verificationService().submitForVerification(doc.id, actor);
    return NextResponse.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
