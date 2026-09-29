import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { doctorForUser } from "@/server/doctors";
import { DoctorProfileForm } from "@/components/DoctorProfileForm";

export default async function Settings() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!actor.roles.includes("doctor")) return <main className="p-8"><h1 className="text-xl font-semibold">Permission denied</h1></main>;
  const d = await doctorForUser(actor.userId);
  if (!d) return <main className="p-8"><p>No doctor profile found.</p></main>;
  return <main className="mx-auto max-w-xl px-4 py-8"><h1 className="mb-6 text-2xl font-semibold">Public profile</h1><DoctorProfileForm initial={{ consultationFeeBdt: d.consultationFeeBdt, bio: d.bio, languages: d.languages, chamberAddress: d.chamberAddress, consultationMode: d.consultationMode, publicProfile: d.publicProfile, status: d.status }} /></main>;
}
