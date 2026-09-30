import Link from "next/link";
import { Doc } from "@/components/site/Doc";

export const metadata = { title: "Contact — SmartDoctorAid", description: "Questions, support and security reports." };

export default function Page() {
  return (
    <Doc title="Contact" lead="Questions, support and security reports.">
<p>{process.env.NEXT_PUBLIC_CONTACT_EMAIL ? <>Email us at <a href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL}`}>{process.env.NEXT_PUBLIC_CONTACT_EMAIL}</a>.</> : "Contact details will be published here before public launch."}</p><p>Please do not send patient information by email. To report a security issue, contact us privately and do not include personal data.</p>
    </Doc>
  );
}
