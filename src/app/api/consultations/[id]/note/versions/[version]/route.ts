import { withActor } from "@/lib/api";
import { consultationService } from "@/server/consultations";
import { ValidationError } from "@/server/errors";

export const GET = withActor(({ actor, params }) => {
  const n = Number(params.version);
  if (!Number.isInteger(n) || n < 1) throw new ValidationError("Invalid version");
  return consultationService().getVersion(actor, params.id, n);
});
