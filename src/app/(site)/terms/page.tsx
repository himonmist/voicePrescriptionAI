import Link from "next/link";
import { Doc } from "@/components/site/Doc";

export const metadata = { title: "Terms of use — SmartDoctorAid", description: "Rules for using SmartDoctorAid." };

export default function Page() {
  return (
    <Doc draft title="Terms of use" lead="Rules for using SmartDoctorAid.">
<h2>Clinical responsibility</h2><p>SmartDoctorAid is documentation software. Doctors remain fully responsible for clinical decisions and for every prescription they sign. AI output is a draft and may be wrong.</p><h2>Accounts</h2><p>Doctors must hold valid BMDC registration and keep their credentials secure.</p><h2>Availability</h2><p>The service is provided as-is during the trial period.</p>
    </Doc>
  );
}
