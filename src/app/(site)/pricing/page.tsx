import Link from "next/link";
import { Doc } from "@/components/site/Doc";

export const metadata = { title: "Pricing — SmartDoctorAid", description: "Free trial now. Paid plans will be announced before billing is switched on." };

export default function Page() {
  return (
    <Doc title="Pricing" lead="Free trial now. Paid plans will be announced before billing is switched on.">
<p>Billing is not live yet. During the trial period verified doctors can use all available features at no cost. We will publish clear plans and prices, in BDT, and tell you before anything changes. You will never be charged without an explicit sign-up for a paid plan.</p><p><Link href="/register/doctor">Start your free trial</Link></p>
    </Doc>
  );
}
