import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";

export default async function PatientDashboard() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return <main className="mx-auto max-w-2xl px-4 py-10"><h1 className="text-2xl font-semibold">Patient dashboard</h1><p className="mt-3 text-slate-600">Appointments and prescriptions will appear here once your doctors share them.</p></main>;
}
