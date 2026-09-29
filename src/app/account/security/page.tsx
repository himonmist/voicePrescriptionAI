import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/current-actor";
import { mfaService } from "@/server/mfa";
import { isPrivileged } from "@/lib/security/rbac";
import { MfaSetup } from "@/components/MfaSetup";

export default async function Security() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const { enabled } = await mfaService().state(actor.userId);
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold">Account security</h1>
      <h2 className="mt-6 mb-3 font-medium">Two-factor authentication</h2>
      <MfaSetup enabled={enabled} required={isPrivileged(actor.roles)} />
    </main>
  );
}
