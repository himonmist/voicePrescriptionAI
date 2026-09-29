import { z } from "zod";
import { withActor } from "@/lib/api";
import { consultationService } from "@/server/consultations";
import { ValidationError } from "@/server/errors";

/** PUT { baseVersion, content, amendmentReason? } — 409 if the note changed since baseVersion. */
export const PUT = withActor(({ actor, params, body }) => {
  const p = z.object({ baseVersion: z.number().int().min(0), content: z.unknown(), amendmentReason: z.string().max(500).optional() }).safeParse(body);
  if (!p.success) throw new ValidationError("baseVersion and content are required");
  return consultationService().saveNote(actor, params.id, p.data);
});
