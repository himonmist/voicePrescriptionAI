import { z } from "zod";
import { withActor } from "@/lib/api";
import { mfaService } from "@/server/mfa";
import { isPrivileged } from "@/lib/security/rbac";
import { ValidationError } from "@/server/errors";

export const POST = withActor(async ({ actor, body }) => {
  const p = z.object({ password: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) }).safeParse(body);
  if (!p.success) throw new ValidationError("Password and 6-digit code are required");
  await mfaService().disable(actor.userId, p.data.password, p.data.code, { privileged: isPrivileged(actor.roles) });
});
