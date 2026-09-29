import { createDrugService } from "./service";
import { drizzleDrugRepo } from "./drizzle-repo";

let svc: ReturnType<typeof createDrugService> | undefined;
export const drugService = () => (svc ??= createDrugService(drizzleDrugRepo()));
