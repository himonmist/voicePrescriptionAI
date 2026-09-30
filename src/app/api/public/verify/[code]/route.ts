import { publicHandler } from "@/lib/public-api";
import { prescriptionService } from "@/server/prescriptions";

/** Public authenticity check. Returns issuer + status + integrity only — never patient or medication data. */
export const GET = publicHandler(({ params }) => prescriptionService().verify(params.code.toUpperCase()));
