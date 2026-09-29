import { withActor } from "@/lib/api";
import { drugService } from "@/server/drugs";

/** GET ?q= — search the loaded, authorized drug reference. The response always includes coverage (what is / is not loaded). */
export const GET = withActor(({ req, actor }) => drugService().search(actor, new URL(req.url).searchParams.get("q") ?? ""));
