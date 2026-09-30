import { describe, it, expect, beforeEach } from "vitest";
import { createPatientRxView, type PatientRxRepo } from "@/server/prescriptions/patient-view";
import { NotFoundError } from "@/server/errors";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";

const pat: Actor = { userId: "u-pat", roles: ["patient"], orgId: null };
const rows = () => [
  { id: "r1", code: "RX-AAAA1111", status: "finalized", patientId: "p1", doctorName: "Dr One", finalizedAt: new Date("2026-10-01T05:00:00Z") },
  { id: "r2", code: "RX-BBBB2222", status: "superseded", patientId: "p1", doctorName: "Dr One", finalizedAt: new Date("2026-09-01T05:00:00Z") },
  { id: "r3", code: "RX-CCCC3333", status: "finalized", patientId: "p2", doctorName: "Dr Two", finalizedAt: new Date("2026-10-02T05:00:00Z") },
];
describe("patient prescription view", () => {
  let audit: any[]; let svc: ReturnType<typeof createPatientRxView>;
  beforeEach(() => {
    audit = [];
    const repo: PatientRxRepo = { async patientIdForUser(u) { return u === "u-pat" ? "p1" : null; }, async listFinalForPatient(pid) { return rows().filter((r) => r.patientId === pid); }, async find(id) { return rows().find((r) => r.id === id) ?? null; }, async audit(e) { audit.push(e); } };
    svc = createPatientRxView(repo, { copy: async (id) => ({ code: id, state: "valid", issuedAt: "x", content: {}, doctor: {}, patient: { name: "P", dob: "1", sex: "f", patientCode: "c" } }) as any });
  });
  it("lists only the patient's own prescriptions, newest first, without content", async () => {
    const l = await svc.list(pat); expect(l.map((r) => r.code)).toEqual(["RX-AAAA1111", "RX-BBBB2222"]); expect(JSON.stringify(l)).not.toContain("RX-CCCC3333");
  });
  it("opens own prescription and audits the view", async () => { const r = await svc.get(pat, "r1"); expect(r.code).toBe("r1"); expect(audit[0].action).toBe("prescription.patient_viewed"); });
  it("another patient's prescription is 404", async () => { await expect(svc.get(pat, "r3")).rejects.toThrow(NotFoundError); await expect(svc.get(pat, "nope")).rejects.toThrow(NotFoundError); });
  it("non-patients are forbidden; patient without a record sees an empty list", async () => {
    await expect(svc.list({ userId: "d", roles: ["doctor"], orgId: null })).rejects.toThrow(ForbiddenError);
    expect(await svc.list({ userId: "u-none", roles: ["patient"], orgId: null })).toEqual([]);
    await expect(svc.get({ userId: "u-none", roles: ["patient"], orgId: null }, "r1")).rejects.toThrow(NotFoundError);
  });
});
