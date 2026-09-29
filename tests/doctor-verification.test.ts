import { describe, it, expect, beforeEach } from "vitest";
import { canTransition, createVerificationService, type VerificationRepo, type DoctorStatus } from "@/server/doctors/verification";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";

const admin: Actor = { userId: "admin1", roles: ["super_admin"], orgId: null };
const doctor: Actor = { userId: "doc1", roles: ["doctor"], orgId: null };

describe("doctor status machine", () => {
  it("allows the documented workflow", () => {
    expect(canTransition("registered", "verification_pending")).toBe(true);
    expect(canTransition("verification_pending", "under_review")).toBe(true);
    expect(canTransition("under_review", "approved")).toBe(true);
    expect(canTransition("under_review", "rejected")).toBe(true);
    expect(canTransition("approved", "active")).toBe(true);
    expect(canTransition("active", "suspended")).toBe(true);
    expect(canTransition("suspended", "active")).toBe(true);
    expect(canTransition("rejected", "verification_pending")).toBe(true);
  });
  it("forbids skipping review", () => {
    expect(canTransition("registered", "approved")).toBe(false);
    expect(canTransition("registered", "active")).toBe(false);
    expect(canTransition("verification_pending", "approved")).toBe(false);
    expect(canTransition("rejected", "active")).toBe(false);
  });
});

function repo() {
  const rows = new Map<string, { status: DoctorStatus; notes?: string }>([["d1", { status: "registered" }]]);
  const audit: { action: string; metadata?: any }[] = [];
  const notes: string[] = [];
  const r: VerificationRepo = {
    async getStatus(id) { return rows.get(id)?.status ?? null; },
    async transition(i) {
      if (rows.get(i.doctorId)?.status !== i.from) throw new Error("concurrent");
      rows.set(i.doctorId, { status: i.to, notes: i.notes });
      audit.push({ action: "doctor.status_changed", metadata: { from: i.from, to: i.to } });
      if (i.notifyKind) notes.push(i.notifyKind);
    },
  };
  return { r, rows, audit, notes };
}

describe("verification service", () => {
  let f: ReturnType<typeof repo>; let svc: ReturnType<typeof createVerificationService>;
  beforeEach(() => { f = repo(); svc = createVerificationService(f.r); });

  it("doctor can submit own docs (registered → pending)", async () => {
    await svc.submitForVerification("d1", doctor);
    expect(f.rows.get("d1")!.status).toBe("verification_pending");
  });
  it("only doctor:verify may review/approve", async () => {
    f.rows.set("d1", { status: "under_review" });
    await expect(svc.decide("d1", "approved", doctor)).rejects.toThrow(ForbiddenError);
    await svc.decide("d1", "approved", admin);
    expect(f.rows.get("d1")!.status).toBe("approved");
  });
  it("rejection requires notes", async () => {
    f.rows.set("d1", { status: "under_review" });
    await expect(svc.decide("d1", "rejected", admin)).rejects.toThrow(/notes/i);
    await svc.decide("d1", "rejected", admin, "BMDC number not found");
    expect(f.rows.get("d1")!.notes).toBe("BMDC number not found");
  });
  it("rejects illegal transitions", async () => {
    await expect(svc.decide("d1", "approved", admin)).rejects.toThrow(/transition/i);
  });
  it("audits and notifies on every decision", async () => {
    f.rows.set("d1", { status: "under_review" });
    await svc.decide("d1", "approved", admin);
    expect(f.audit.map((a) => a.action)).toContain("doctor.status_changed");
    expect(f.notes).toContain("doctor_approved");
  });
  it("only approved/active doctors count as verified", async () => {
    expect(svc.isVerified("registered")).toBe(false);
    expect(svc.isVerified("under_review")).toBe(false);
    expect(svc.isVerified("approved")).toBe(false);
    expect(svc.isVerified("active")).toBe(true);
  });
});
