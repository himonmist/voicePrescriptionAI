import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { availabilityService } from "@/server/appointments";
import { ScheduleEditor, type ExRow, type RuleRow } from "@/components/ScheduleEditor";

export default async function Schedule() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!actor.roles.includes("doctor")) return <main className="p-8"><h1 className="text-xl font-semibold">Permission denied</h1></main>;
  const s = await availabilityService().getSchedule(actor);
  return <main className="mx-auto max-w-4xl px-4 py-8"><h1 className="mb-6 text-2xl font-semibold">Schedule</h1><ScheduleEditor initial={s.rules as RuleRow[]} exceptions={s.exceptions as ExRow[]} /></main>;
}
