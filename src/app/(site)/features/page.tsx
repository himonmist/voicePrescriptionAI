import Link from "next/link";
import { Doc } from "@/components/site/Doc";

export const metadata = { title: "Features — SmartDoctorAid", description: "What SmartDoctorAid does today, and what is still on the way." };

export default function Page() {
  return (
    <Doc title="Features" lead="What SmartDoctorAid does today, and what is still on the way.">
<h2>Available now</h2><ul><li>Doctor registration with BMDC verification by an administrator</li><li>Patient registry with encrypted contact details, allergies, conditions and consent history</li><li>Online booking with a verified-doctor directory, weekly schedules, holidays and no double-booking</li><li>Consultation workspace: bilingual transcript entry, 15-section clinical note, vitals flags, immutable versions and amendments</li><li>Prescriptions: drafting, doctor approval, password-confirmed signing, amendment and cancellation</li><li>QR verification page that shows the issuer and integrity, never patient data</li><li>A4 print, English PDF and expiring, revocable share links</li></ul><h2>Coming next</h2><ul><li>Voice capture and AI drafting (Bangla, English, mixed) — always a draft for the doctor to review</li><li>Online payments (SSLCommerz, bKash), invoices and plans</li><li>Video consultations and report upload</li><li>Email, SMS and WhatsApp delivery and reminders</li></ul><p>Drug and interaction screening uses only reference data imported from an authorized source. Until such data is loaded, the software says screening is unavailable rather than guessing.</p>
    </Doc>
  );
}
