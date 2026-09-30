import Link from "next/link";
import { Doc } from "@/components/site/Doc";

export const metadata = { title: "Frequently asked questions — SmartDoctorAid", description: "Short, honest answers." };

export default function Page() {
  return (
    <Doc title="Frequently asked questions" lead="Short, honest answers.">
<h2>Does the AI write the prescription?</h2><p>It can prepare a draft. Only the doctor can approve and sign, and nothing is issued without that.</p><h2>Who can see patient records?</h2><p>The treating doctor, and other doctors only when the treating doctor shares a record for a limited time. Administrators cannot read clinical data.</p><h2>Is the prescription legally digitally signed?</h2><p>It carries an integrity seal from the platform proving it is unchanged since signing. It is not a certificate-authority digital signature. Check current Bangladesh rules with your own advisers.</p><h2>Does it check drug interactions?</h2><p>Only using reference data loaded from an authorized source, and it always lists what was not checked. It supports, and never replaces, your judgement.</p><h2>Which languages work?</h2><p>Bangla, English and mixed. Bengali PDF export is done through your browser print dialog for now.</p><h2>How are doctors verified?</h2><p>An administrator reviews the BMDC registration before a doctor becomes visible to patients.</p>
    </Doc>
  );
}
