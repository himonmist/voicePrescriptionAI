import Link from "next/link";
import { Doc } from "@/components/site/Doc";

export const metadata = { title: "How it works — SmartDoctorAid", description: "From consultation to a verifiable prescription, with the doctor in control at every step." };

export default function Page() {
  return (
    <Doc title="How it works" lead="From consultation to a verifiable prescription, with the doctor in control at every step.">
<h2>1. Consult</h2><p>Start a consultation from an appointment or as a walk-in. Recording needs the patient recorded consent and stops immediately if it is withdrawn.</p><h2>2. Review the draft</h2><p>The note and prescription are prepared for you. Unclear or missing details are flagged for your decision and are never filled in silently.</p><h2>3. Approve and sign</h2><p>You approve, then confirm your password to sign. The prescription is sealed and gets a QR code. Once sealed it cannot be edited; a correction creates a linked amendment with a reason.</p><h2>4. Share and verify</h2><p>Print it, download the PDF, or create an expiring link that needs the patient date of birth. Pharmacists can scan the QR to confirm authenticity.</p><h2 id="safety">Safety principles</h2><ul><li>AI never signs or finalizes; only the treating doctor does.</li><li>No clinical or drug data is invented; missing information stays missing.</li><li>Every alert override needs a written reason.</li><li>Audit logs never contain clinical text.</li><li>The integrity seal proves the content is unchanged; it is not a certificate-authority digital signature.</li></ul>
    </Doc>
  );
}
