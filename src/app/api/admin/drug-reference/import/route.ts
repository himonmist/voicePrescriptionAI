import { withActor } from "@/lib/api";
import { drugService } from "@/server/drugs";

/** POST { source:{name,version,publishedAt,licenceNote}, drugs:[…], interactions:[…] } — super admin only. Data must come from an authorized source. */
export const POST = withActor(({ actor, body }) => drugService().importReference(actor, body), { status: 201 });
