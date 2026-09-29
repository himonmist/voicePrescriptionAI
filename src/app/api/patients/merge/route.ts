import { z } from "zod";
import { withActor } from "@/lib/api";
import { patientService } from "@/server/patients";
import { ValidationError } from "@/server/errors";

export const POST = withActor(async ({ actor, body }) => {
  const p = z.object({ sourceId: z.uuid(), targetId: z.uuid(), reason: z.string().trim().min(10).max(500) }).safeParse(body);
  if (!p.success) throw new ValidationError("sourceId, targetId and a reason (min 10 characters) are required");
  await patientService().mergePatients(actor, p.data.sourceId, p.data.targetId, p.data.reason);
});
