import Link from "next/link";
import { Doc } from "@/components/site/Doc";

export const metadata = { title: "Privacy policy — SmartDoctorAid", description: "How personal and health information is handled." };

export default function Page() {
  return (
    <Doc draft title="Privacy policy" lead="How personal and health information is handled.">
<h2>What we collect</h2><p>Account details for doctors and patients, and the health information doctors record about their patients.</p><h2>How it is protected</h2><ul><li>Contact details and clinical text are encrypted at rest</li><li>Access is limited by role and by the treating relationship</li><li>Every view of a patient record is logged</li></ul><h2>Your choices</h2><p>Patients can withdraw recording consent at any time. Data export and deletion procedures are being finalized with legal advice.</p>
    </Doc>
  );
}
