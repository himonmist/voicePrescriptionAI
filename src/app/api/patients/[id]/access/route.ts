import { z } from "zod";
import { withActor } from "@/lib/api";
import { patientService } from "@/server/patients";
import { ValidationError } from "@/server/errors";

/** POST — treating doctor shares this patient with another verified doctor (reason + expiry required). */
export const POST = withActor(({ actor, params, body }) => patientService().shareAccess(actor, params.id, body), { status: 201 });

/** DELETE — body { doctorUserId }: treating doctor revokes a share, or a shared doctor leaves. */
export const DELETE = withActor(async ({ actor, params, body }) => {
  const p = z.object({ doctorUserId: z.string().min(1) }).safeParse(body);
  if (!p.success) throw new ValidationError("doctorUserId is required");
  await patientService().revokeAccess(actor, params.id, p.data.doctorUserId);
});
