import { withActor } from "@/lib/api";
import { accountLabel, mfaService } from "@/server/mfa";

/** POST — begins TOTP enrolment. Returns the secret once; MFA is not active until /confirm succeeds. */
export const POST = withActor(async ({ actor }) => mfaService().start(actor.userId, await accountLabel(actor.userId)));
