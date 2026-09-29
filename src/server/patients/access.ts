import { can, type Actor } from "@/lib/security/rbac";

export type AccessLevel = "none" | "demographics" | "clinical" | "self";
export interface PatientRef { id: string; organizationId: string | null; userId: string | null; status: "active" | "merged" | "archived" }
export interface Relationship { doctorUserId: string; kind: "treating" | "shared"; expiresAt: Date | null; revokedAt: Date | null }

export const isRelationshipActive = (r: Relationship, now = new Date()) => !r.revokedAt && (!r.expiresAt || r.expiresAt > now);

/**
 * Single source of truth for patient-record access. Deny by default.
 * - Doctors need an explicit active relationship (org membership alone is NOT enough).
 * - Receptionists: demographics only, same organization only.
 * - Patients: only their own linked record.
 * - Platform/finance/support/content/org-admin: none.
 */
export function accessLevel(actor: Actor, patient: PatientRef, relationships: Relationship[], now = new Date()): AccessLevel {
  if (patient.status !== "active") return "none";
  if (actor.roles.includes("patient") && patient.userId && patient.userId === actor.userId) return "self";
  if (actor.roles.includes("doctor") && can(actor, "patient:read") && relationships.some((r) => r.doctorUserId === actor.userId && isRelationshipActive(r, now))) return "clinical";
  if (actor.roles.includes("receptionist") && can(actor, "patient:read") && patient.organizationId && patient.organizationId === actor.orgId) return "demographics";
  return "none";
}
