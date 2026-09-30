import { z } from "zod";
import { withActor } from "@/lib/api";
import { prescriptionService } from "@/server/prescriptions";
import { ValidationError } from "@/server/errors";

export const GET = withActor(({ actor, params }) => prescriptionService().get(actor, params.id));

/** PUT { baseVersion, content } — 409 if changed since baseVersion; 422 if not a draft. */
export const PUT = withActor(({ actor, params, body }) => {
  const p = z.object({ baseVersion: z.number().int().min(1), content: z.unknown() }).safeParse(body);
  if (!p.success) throw new ValidationError("baseVersion and content are required");
  return prescriptionService().saveDraft(actor, params.id, p.data);
});
