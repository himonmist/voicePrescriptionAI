import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { appointmentService } from "@/server/appointments";
import { MAX_LIST_DAYS } from "@/server/appointments/service";
import { fmtWhen } from "@/lib/format";
import { addDays, utcToZoned } from "@/lib/time";
import { AppointmentActions } from "@/components/AppointmentActions";

export default async function MyAppointments() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!actor.roles.includes("patient")) return <main className="p-8"><h1 className="text-xl font-semibold">Permission denied</h1></main>;
  const today = utcToZoned(new Date()).date;
  const list = await appointmentService().list(actor, addDays(today, -14), addDays(today, MAX_LIST_DAYS - 14));
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">My appointments</h1><Link href="/doctors" className="rounded bg-[var(--brand)] px-3 py-2 text-sm font-medium text-white">Find a doctor</Link></div>
      {list.length === 0 ? <p className="mt-8 text-slate-600">You have no appointments yet.</p> : (
        <ul className="mt-6 divide-y rounded border">{list.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div><p className="font-medium">{a.doctorName}</p><p className="text-sm text-slate-600">{fmtWhen(a.startAt)} · {a.mode === "online" ? "Online" : "In person"}{a.location ? ` · ${a.location}` : ""}</p></div>
            <div className="flex items-center gap-3"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{a.status.replace("_", " ")}</span><AppointmentActions id={a.id} status={a.status} role="patient" doctorId={a.doctorUserId} mode={a.mode} /></div>
          </li>))}</ul>)}
      <p className="mt-4 text-xs text-slate-500">Online cancellation closes 2 hours before your appointment.</p>
    </main>
  );
}
