import { z } from "zod";
import { withActor } from "@/lib/api";
import { patientService } from "@/server/patients";
import { ValidationError } from "@/server/errors";

const schema = z.object({ status: z.enum(["resolved", "entered_in_error"]), reason: z.string().trim().min(1).max(500) });

/** PATCH — clinical items are never deleted; they are resolved or marked entered-in-error with a reason. */
export const PATCH = withActor(async ({ actor, params, body }) => {
  const p = schema.safeParse(body);
  if (!p.success) throw new ValidationError("Status and reason are required");
  await patientService().setClinicalItemStatus(actor, params.id, params.itemId, p.data.status, p.data.reason);
});
