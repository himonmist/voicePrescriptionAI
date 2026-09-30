import { SharedPrescription } from "@/components/SharedPrescription";

export const metadata = { title: "Your prescription — SmartDoctorAid", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

/** Public, token-gated. The token never leaves the URL path; the DOB is sent in a POST body, never in a URL. */
export default async function SharedRxPage({ params }: { params: Promise<{ token: string }> }) {
  return <SharedPrescription token={(await params).token} />;
}
