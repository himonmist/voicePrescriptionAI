import { createPrescriptionService } from "./service";
import { drizzleRxRepo } from "./drizzle-repo";
import { rxDepsFor } from "./deps";

let svc: ReturnType<typeof createPrescriptionService> | undefined;
export const prescriptionService = () => (svc ??= createPrescriptionService(drizzleRxRepo(), rxDepsFor()));

import { createShareService } from "./share";
import { drizzleShareRepo } from "./share-repo";
import { patientAccessFor } from "@/server/appointments/access";
import { getDb } from "@/db/client";

let share: ReturnType<typeof createShareService> | undefined;
export const shareService = () => (share ??= createShareService(drizzleShareRepo(), { patientAccess: patientAccessFor(getDb()), sealedCopy: (id) => prescriptionService().sealedCopy(id) }));

import { createPatientRxView } from "./patient-view";
import { drizzlePatientRxRepo } from "./patient-repo";
let pv: ReturnType<typeof createPatientRxView> | undefined;
export const patientRxView = () => (pv ??= createPatientRxView(drizzlePatientRxRepo(), { copy: (id) => prescriptionService().sealedCopyAny(id) }));
