import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { NewPatientForm } from "@/components/NewPatientForm";

export default async function NewPatient() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return <main className="mx-auto max-w-xl px-4 py-8"><h1 className="text-2xl font-semibold">Register patient</h1><p className="mt-1 text-sm text-slate-600">Duplicate check runs only across patients you already have access to.</p><NewPatientForm /></main>;
}
