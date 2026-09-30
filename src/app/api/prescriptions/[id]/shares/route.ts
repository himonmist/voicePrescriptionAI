import { withActor } from "@/lib/api";
import { shareService } from "@/server/prescriptions";

export const GET = withActor(({ actor, params }) => shareService().listLinks(actor, params.id));
/** Returns the token ONCE, as a full URL path the doctor can hand to the patient. */
export const POST = withActor(async ({ actor, params, body }) => {
  const r = await shareService().createLink(actor, params.id, (body ?? {}) as { expiresInDays?: unknown });
  return { shareId: r.shareId, path: `/rx/${r.token}`, expiresAt: r.expiresAt };
}, { status: 201 });
