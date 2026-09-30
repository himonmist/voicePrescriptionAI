import { withActor } from "@/lib/api";
import { shareService } from "@/server/prescriptions";

export const DELETE = withActor(async ({ actor, params }) => { await shareService().revokeLink(actor, params.id, params.shareId); return { ok: true }; });
