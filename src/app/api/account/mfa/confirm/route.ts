import { z } from "zod";
import { withActor } from "@/lib/api";
import { mfaService } from "@/server/mfa";
import { ValidationError } from "@/server/errors";

/** POST { code } — enables MFA, returns recovery codes ONCE, and revokes all sessions (re-login required). */
export const POST = withActor(async ({ actor, body }) => {
  const p = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(body);
  if (!p.success) throw new ValidationError("Enter the 6-digit code");
  return mfaService().confirm(actor.userId, p.data.code);
});
