import { createAppointmentService } from "./service";
import { drizzleApptRepo } from "./drizzle-repo";
import { createAvailabilityService } from "./availability";
import { drizzleAvailabilityRepo } from "./drizzle-availability";
import { patientAccessFor } from "./access";

let a: ReturnType<typeof createAppointmentService> | undefined;
let v: ReturnType<typeof createAvailabilityService> | undefined;
export const appointmentService = () => (a ??= createAppointmentService(drizzleApptRepo(), { patientAccess: patientAccessFor() }));
export const availabilityService = () => (v ??= createAvailabilityService(drizzleAvailabilityRepo()));
