import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { hasDb, setupTestDb } from "./db";
import { drizzleAuthRepo } from "@/server/auth/drizzle-repo";
import { drizzlePatientRepo } from "@/server/patients/drizzle-repo";
import { createPatientService } from "@/server/patients/service";
import { patients, patientClinicalItems, patientDoctorRelationships, organizations, doctorProfiles } from "@/db/schema";
import { phoneBlindIndex } from "@/lib/security/pii";
import type { Actor } from "@/lib/security/rbac";

describe.skipIf(!hasDb)("patients repo (real Postgres)", () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  let svc: ReturnType<typeof createPatientService>;
  let repo: ReturnType<typeof drizzlePatientRepo>;
  let orgA: string, orgB: string;
  const users: Record<string, string> = {};

  beforeAll(async () => { process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64"); ctx = await setupTestDb(); repo = drizzlePatientRepo(ctx.db); svc = createPatientService(repo); });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => {
    await ctx.db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update`);
    await ctx.db.execute(sql`TRUNCATE audit_events, patient_merges, patient_clinical_items, patient_consents, patient_doctor_relationships, patients, notifications, doctor_credentials, doctor_profiles, sessions, user_roles, organization_memberships, organizations, users, rate_limits CASCADE`);
    await ctx.db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update`);
    [orgA, orgB] = (await ctx.db.insert(organizations).values([{ name: "A", slug: "a" }, { name: "B", slug: "b" }]).returning()).map((o) => o.id);
    const auth = drizzleAuthRepo(ctx.db);
    for (const [key, org, status] of [["d1", orgA, "active"], ["d2", orgB, "active"], ["d3", orgA, "active"], ["d4", orgA, "under_review"]] as const) {
      const u = await auth.createUser({ email: `${key}@x.com`, fullName: `Dr ${key}`, phone: "01712345678", passwordHash: "h", roles: ["doctor"] });
      await auth.createDoctorProfile({ userId: u.id, bmdcNumber: `B-${key}`, specialty: "GP" });
      await ctx.db.update(doctorProfiles).set({ status, organizationId: org }).where(eq(doctorProfiles.userId, u.id));
      users[key] = u.id;
    }
    const r = await auth.createUser({ email: "r@x.com", fullName: "Recep", phone: "01712345679", passwordHash: "h", roles: ["receptionist"] });
    users.r = r.id;
  });
  const doc = (k: string, org: string | null): Actor => ({ userId: users[k], roles: ["doctor"], orgId: org });
  const P = { fullName: "Md Rahim Uddin", dob: "1985-03-12", sex: "male", phone: "01712345678", email: "rahim@example.com", address: "House 4, Road 2, Dhaka", emergencyContact: { name: "Ayesha", phone: "01812345678", relation: "spouse" } };

  it("stores PHI encrypted at rest and a blind index for phone; round-trips on read", async () => {
    const { patientId } = await svc.createPatient(doc("d1", orgA), P);
    const raw = await ctx.db.execute(sql`SELECT phone_enc, email_enc, address_enc, emergency_contact_enc, phone_idx FROM patients WHERE id = ${patientId}`);
    const row = JSON.stringify(raw.rows[0]);
    for (const secret of ["01712345678", "+8801712345678", "rahim@example.com", "House 4", "Ayesha", "01812345678"]) expect(row).not.toContain(secret);
    expect((raw.rows[0] as any).phone_idx).toBe(phoneBlindIndex("01712345678"));
    const v = await svc.getPatient(doc("d1", orgA), patientId);
    expect(v.patient).toMatchObject({ phone: "+8801712345678", email: "rahim@example.com", address: "House 4, Road 2, Dhaka", emergencyContact: { name: "Ayesha" } });
  });

  it("clinical item text is encrypted at rest", async () => {
    const { patientId } = await svc.createPatient(doc("d1", orgA), P);
    await svc.addClinicalItem(doc("d1", orgA), patientId, { kind: "allergy", description: "Penicillin anaphylaxis", severity: "severe" });
    const [row] = await ctx.db.select().from(patientClinicalItems);
    expect(row.descriptionEnc).not.toContain("Penicillin");
    expect((await svc.getPatient(doc("d1", orgA), patientId)).clinical!.items[0].description).toBe("Penicillin anaphylaxis");
  });

  it("generates unique human-readable patient codes", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 5; i++) codes.add((await svc.createPatient(doc("d1", orgA), { ...P, fullName: `Person ${i}`, dob: `19${60 + i}-01-01`, phone: `0171000000${i}` })).patientCode);
    expect(codes.size).toBe(5);
    for (const c of codes) expect(c).toMatch(/^SDA-[0-9A-Z]{8}$/);
  });

  it("dedupe + search are scoped: another doctor's patients are invisible", async () => {
    await svc.createPatient(doc("d1", orgA), P);
    const res = await svc.createPatient(doc("d3", orgA), P); // same org, different doctor → no leak, no conflict
    expect(res.patientId).toBeTruthy();
    expect((await svc.search(doc("d1", orgA), "rahim")).length).toBe(1);
    expect((await svc.search(doc("d2", orgB), "rahim")).length).toBe(0);
  });

  it("search by phone uses the blind index and by patient code", async () => {
    const { patientCode } = await svc.createPatient(doc("d1", orgA), P);
    expect((await svc.search(doc("d1", orgA), "017-1234 5678")).map((x) => x.patientCode)).toEqual([patientCode]);
    expect((await svc.search(doc("d1", orgA), patientCode)).length).toBe(1);
  });

  it("search escapes LIKE wildcards (no accidental match-all)", async () => {
    await svc.createPatient(doc("d1", orgA), P);
    expect((await svc.search(doc("d1", orgA), "%%")).length).toBe(0);
    expect((await svc.search(doc("d1", orgA), "r_him")).length).toBe(0);
  });

  it("receptionist registers for an org doctor; sees demographics but not clinical", async () => {
    const rec: Actor = { userId: users.r, roles: ["receptionist"], orgId: orgA };
    const { patientId } = await svc.createPatient(rec, P, { forDoctorUserId: users.d1 });
    expect((await svc.getPatient(rec, patientId)).clinical).toBeUndefined();
    expect((await svc.getPatient(doc("d1", orgA), patientId)).level).toBe("clinical");
    await expect(svc.createPatient(rec, { ...P, fullName: "X Y", phone: "01911111111" }, { forDoctorUserId: users.d2 })).rejects.toThrow();
  });

  it("one ACTIVE relationship per doctor/patient (partial unique) but re-granting after revoke works", async () => {
    const { patientId } = await svc.createPatient(doc("d1", orgA), P);
    await svc.shareAccess(doc("d1", orgA), patientId, { doctorUserId: users.d3, reason: "Referral", expiresInDays: 10 });
    await expect(ctx.db.insert(patientDoctorRelationships).values({ patientId, doctorUserId: users.d3, kind: "shared", grantedBy: users.d1 })).rejects.toThrow();
    await svc.revokeAccess(doc("d1", orgA), patientId, users.d3);
    await svc.shareAccess(doc("d1", orgA), patientId, { doctorUserId: users.d3, reason: "Referral again", expiresInDays: 10 });
    expect((await svc.getPatient(doc("d3", orgA), patientId)).level).toBe("clinical");
  });

  it("expired share stops working without any cleanup job", async () => {
    const { patientId } = await svc.createPatient(doc("d1", orgA), P);
    await svc.shareAccess(doc("d1", orgA), patientId, { doctorUserId: users.d3, reason: "Referral", expiresInDays: 1 });
    await ctx.db.execute(sql`UPDATE patient_doctor_relationships SET expires_at = now() - interval '1 minute' WHERE doctor_user_id = ${users.d3}`);
    await expect(svc.getPatient(doc("d3", orgA), patientId)).rejects.toThrow(/not found/i);
  });

  it("consent history is append-only and latest wins", async () => {
    const { patientId } = await svc.createPatient(doc("d1", orgA), P);
    await svc.recordConsent(doc("d1", orgA), patientId, { kind: "recording", granted: true, method: "in_person" });
    await svc.recordConsent(doc("d1", orgA), patientId, { kind: "recording", granted: false, method: "in_person" });
    expect(await svc.hasActiveConsent(patientId, "recording")).toBe(false);
    const n = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM patient_consents`);
    expect((n.rows[0] as any).n).toBe(2);
  });

  it("merge moves clinical data + access to the target atomically and records the merge", async () => {
    const a = (await svc.createPatient(doc("d1", orgA), P)).patientId;
    const b = (await svc.createPatient(doc("d1", orgA), { ...P, fullName: "Rahim Uddin" }, { confirmNotDuplicate: true })).patientId;
    await svc.addClinicalItem(doc("d1", orgA), a, { kind: "allergy", description: "Sulfa drugs" });
    await svc.recordConsent(doc("d1", orgA), a, { kind: "recording", granted: true, method: "in_person" });
    await svc.mergePatients(doc("d1", orgA), a, b, "Duplicate registration confirmed");
    const [src] = await ctx.db.select().from(patients).where(eq(patients.id, a));
    expect(src).toMatchObject({ status: "merged", mergedIntoId: b });
    const items = (await svc.getPatient(doc("d1", orgA), b)).clinical!.items;
    expect(items.map((i) => i.description)).toContain("Sulfa drugs");
    expect(await svc.hasActiveConsent(b, "recording")).toBe(true);
    await expect(svc.getPatient(doc("d1", orgA), a)).rejects.toThrow(/not found/i);
    const m = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM patient_merges`);
    expect((m.rows[0] as any).n).toBe(1);
  });

  it("read access is audited without PHI in metadata", async () => {
    const { patientId } = await svc.createPatient(doc("d1", orgA), P);
    await svc.getPatient(doc("d1", orgA), patientId);
    const rows = await ctx.db.execute(sql`SELECT metadata::text AS m, action FROM audit_events WHERE action IN ('patient.viewed','patient.created')`);
    expect(rows.rows.length).toBe(2);
    expect(JSON.stringify(rows.rows)).not.toMatch(/Rahim|01712345678|rahim@/);
  });
});
