import { publicHandler } from "@/lib/public-api";
import { getDb } from "@/db/client";
import { listPublicDoctors } from "@/server/directory/queries";

export const GET = publicHandler(async ({ req }) => {
  const u = new URL(req.url); const mode = u.searchParams.get("mode");
  return listPublicDoctors(getDb(), { q: u.searchParams.get("q") ?? undefined, specialty: u.searchParams.get("specialty") ?? undefined, mode: mode === "online" || mode === "in_person" ? mode : undefined, page: Number(u.searchParams.get("page")) || 1 });
}, { cacheSeconds: 30 });
