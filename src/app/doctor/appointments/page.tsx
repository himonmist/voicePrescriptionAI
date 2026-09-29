import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { appointmentService } from "@/server/appointments";
import { fmtWhen } from "@/lib/format";
import { addDays, isValidDate, utcToZoned } from "@/lib/time";
import { AppointmentActions } from "@/components/AppointmentActions";

export default async function DoctorAppointments({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const isDoc = actor.roles.includes("doctor"), isRec = actor.roles.includes("receptionist");
  if (!isDoc && !isRec) return <main className="p-8"><h1 className="text-xl font-semibold">Permission denied</h1></main>;
  const q = (await searchParams).date;
  const date = q && isValidDate(q) ? q : utcToZoned(new Date()).date;
  const list = await appointmentService().list(actor, date, date);
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Appointments · {date}</h1>
      <nav className="mt-2 flex gap-3 text-sm" aria-label="Day"><Link className="underline" href={`?date=${addDays(date, -1)}`}>← previous</Link><Link className="underline" href="?">today</Link><Link className="underline" href={`?date=${addDays(date, 1)}`}>next →</Link></nav>
      {list.length === 0 ? <p className="mt-8 text-slate-600">No appointments on this day.</p> : (
        <ul className="mt-6 divide-y rounded border">{list.map((a) => (
          <li key={a.id} className="space-y-1 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="font-medium">{fmtWhen(a.startAt).split(", ")[1]} · {a.patientName}{isDoc && <> · <Link className="text-sm underline" href={`/doctor/patients/${a.patientId}`}>record</Link></>}</p>
                <p className="text-sm text-slate-600">{a.mode === "online" ? "Online" : "In person"}{isDoc && a.reason ? ` · ${a.reason}` : ""}{isRec && a.doctorName ? ` · ${a.doctorName}` : ""}</p></div>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{a.status.replace("_", " ")}</span>
            </div>
            <AppointmentActions id={a.id} status={a.status} role={isDoc ? "doctor" : "reception"} />
          </li>))}</ul>)}
    </main>
  );
}
