import { withActor } from "@/lib/api";
import { patientService } from "@/server/patients";

/** GET /api/patients?q=...&page=1 — scoped search (own patients for doctors, own org for receptionists). */
export const GET = withActor(async ({ req, actor }) => {
  const u = new URL(req.url);
  return { results: await patientService().search(actor, u.searchParams.get("q") ?? "", Number(u.searchParams.get("page")) || 1) };
});

/**
 * POST /api/patients — body: patient fields, plus optional `confirmNotDuplicate` and `forDoctorUserId` (receptionists).
 * Responds 409 with `duplicates` when a probable duplicate exists.
 */
export const POST = withActor(async ({ actor, body }) => {
  const { confirmNotDuplicate, forDoctorUserId, ...fields } = (body ?? {}) as Record<string, unknown>;
  return patientService().createPatient(actor, fields, { confirmNotDuplicate: confirmNotDuplicate === true, forDoctorUserId: typeof forDoctorUserId === "string" ? forDoctorUserId : undefined });
}, { status: 201 });
