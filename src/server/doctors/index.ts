import { getDb } from "@/db/client";
import { drizzleVerificationRepo } from "./drizzle-repo";
import { createVerificationService } from "./verification";
import { getDoctorByUserId } from "./queries";

let svc: ReturnType<typeof createVerificationService> | undefined;
export const verificationService = () => (svc ??= createVerificationService(drizzleVerificationRepo()));
export const doctorForUser = (userId: string) => getDoctorByUserId(getDb(), userId);
