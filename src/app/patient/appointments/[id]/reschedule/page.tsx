import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { ReschedulePicker } from "@/components/ReschedulePicker";

export const metadata = { title: "Reschedule — SmartDoctorAid" };

export default async function Reschedule({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doctor?: string; mode?: string }> }) {
  const actor = await getActor(); if (!actor) redirect("/login");
  const { id } = await params; const sp = await searchParams;
  if (!sp.doctor) redirect("/patient/appointments");
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Reschedule appointment</h1>
      <p className="mt-1 text-sm text-slate-600">Choose a new time. The server re-checks that it is genuinely open.</p>
      <ReschedulePicker appointmentId={id} doctorId={sp.doctor} mode={sp.mode === "online" ? "online" : "in_person"} backHref="/patient/appointments" />
    </main>
  );
}
