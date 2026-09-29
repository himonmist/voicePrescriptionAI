import { createAuthService } from "./service";
import { drizzleAuthRepo } from "./drizzle-repo";
import { dbRateLimiter } from "@/lib/security/rate-limit-db";

let svc: ReturnType<typeof createAuthService> | undefined;
export const authService = () => (svc ??= createAuthService(drizzleAuthRepo(), dbRateLimiter));
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
