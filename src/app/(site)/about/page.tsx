import Link from "next/link";
import { Doc } from "@/components/site/Doc";

export const metadata = { title: "About — SmartDoctorAid", description: "Documentation software for clinicians, built with safety first." };

export default function Page() {
  return (
    <Doc title="About" lead="Documentation software for clinicians, built with safety first.">
<p>SmartDoctorAid helps doctors in Bangladesh spend less time typing and more time with patients. It prepares drafts; the doctor decides. Our design rules — no invented clinical data, no silent overwrites, doctor approval for everything — are described on the <Link href="/how-it-works#safety">safety principles</Link> page.</p>
    </Doc>
  );
}
