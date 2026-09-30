import { z } from "zod";
import { withActor } from "@/lib/api";
import { prescriptionService } from "@/server/prescriptions";
import { ValidationError } from "@/server/errors";

/** POST { password } — signing requires the doctor's password again (step-up). */
export const POST = withActor(({ actor, params, body }) => {
  const p = z.object({ password: z.string().min(1).max(128) }).safeParse(body);
  if (!p.success) throw new ValidationError("Enter your password to sign");
  return prescriptionService().finalize(actor, params.id, p.data);
});
