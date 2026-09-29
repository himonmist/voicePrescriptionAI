import { z } from "zod";
import { withActor } from "@/lib/api";
import { consultationService } from "@/server/consultations";
import { ValidationError } from "@/server/errors";

/** POST { action: start|pause|resume|stop }. Server verifies recorded consent. NOTE: no audio is captured yet (needs the M8 speech-to-text provider). */
export const POST = withActor(({ actor, params, body }) => {
  const p = z.object({ action: z.enum(["start", "pause", "resume", "stop"]) }).safeParse(body);
  if (!p.success) throw new ValidationError("Unknown recording action");
  return consultationService().recording(actor, params.id, p.data.action);
});
