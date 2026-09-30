import { sharedRx } from "@/server/prescriptions/share-public";

export const runtime = "nodejs";
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) { return sharedRx(req, (await ctx.params).token, "open"); }
