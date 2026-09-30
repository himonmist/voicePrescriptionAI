import { headers } from "next/headers";
import { dbRateLimiter } from "@/lib/security/rate-limit-db";
import { prescriptionService } from "@/server/prescriptions";
import { NotFoundError } from "@/server/errors";

export const metadata = { title: "Verify a prescription — SmartDoctorAid", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  const h = await headers(); const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (!(await dbRateLimiter.hit(`public:${ip}`, 120, 60_000)).allowed) return <main className="mx-auto max-w-lg p-8"><h1 className="text-xl font-semibold">Too many requests</h1><p>Please wait a minute and try again.</p></main>;
  let v;
  try { v = await prescriptionService().verify(code); } catch (e) { if (e instanceof NotFoundError) v = null; else throw e; }
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold">Prescription verification</h1>
      {!v ? (
        <p role="alert" className="mt-6 rounded border-2 border-red-700 bg-red-50 p-4"><strong>Not found.</strong> No finalized prescription matches <code>{code}</code>. Check the code, or ask the doctor. Do not dispense on the basis of this result.</p>
      ) : (
        <div className="mt-6 space-y-3">
          <p role="status" className={`rounded border-2 p-4 ${v.status === "valid" && v.integrity === "valid" ? "border-green-700 bg-green-50" : "border-amber-700 bg-amber-50"}`}>
            <strong>{v.integrity !== "valid" ? "⚠ Integrity check FAILED — do not rely on this prescription." : v.status === "valid" ? "✔ Authentic and unchanged since it was issued." : v.status === "superseded" ? "⚠ This prescription has been AMENDED. Ask the patient for the current version." : "⚠ This prescription was CANCELLED."}</strong>
          </p>
          <dl className="grid grid-cols-[9rem_1fr] gap-1 text-sm"><dt className="text-slate-500">Prescription ID</dt><dd>{v.code}</dd><dt className="text-slate-500">Issued by</dt><dd>{v.doctorName}</dd><dt className="text-slate-500">Specialty</dt><dd>{v.specialty}</dd><dt className="text-slate-500">BMDC registration</dt><dd>{v.bmdc}</dd><dt className="text-slate-500">Issued</dt><dd>{v.issuedAt.slice(0, 10)}</dd>{v.supersededByCode && <><dt className="text-slate-500">Replaced by</dt><dd>{v.supersededByCode}</dd></>}</dl>
          <p className="text-xs text-slate-600">This check confirms who issued the prescription and that its content is unchanged since sealing. It does not show patient or medication details. The seal is applied by the SmartDoctorAid platform; it is not a certificate-authority digital signature.</p>
        </div>)}
    </main>
  );
}
