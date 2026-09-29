import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, uniqueIndex, index, pgEnum, primaryKey, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum("role", ["super_admin", "org_admin", "doctor", "receptionist", "patient", "support", "finance", "content_manager"]);
export const doctorStatusEnum = pgEnum("doctor_status", ["registered", "verification_pending", "under_review", "approved", "rejected", "active", "suspended"]);
export const orgTypeEnum = pgEnum("org_type", ["independent", "clinic", "hospital"]);

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  phone: text("phone"),
  fullName: text("full_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  isTestAccount: boolean("is_test_account").notNull().default(false),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  mfaSecretEnc: text("mfa_secret_enc"),
  mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("users_email_uq").on(t.email), index("users_phone_idx").on(t.phone)]);

export const userRoles = pgTable("user_roles", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull(),
  organizationId: uuid("organization_id"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.role] })]);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  type: orgTypeEnum("type").notNull().default("independent"),
  isTest: boolean("is_test").notNull().default(false),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("org_slug_uq").on(t.slug)]);

export const organizationMemberships = pgTable("organization_memberships", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("org_member_uq").on(t.organizationId, t.userId), index("org_member_user_idx").on(t.userId)]);

/** Server-side session rows make access tokens revocable (spec §23 session revocation). */
export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  refreshHash: text("refresh_hash").notNull(),
  userAgent: text("user_agent"),
  ip: text("ip"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId), uniqueIndex("sessions_refresh_uq").on(t.refreshHash)]);

export const doctorProfiles = pgTable("doctor_profiles", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizations.id),
  bmdcNumber: text("bmdc_number").notNull(),
  specialty: text("specialty").notNull(),
  status: doctorStatusEnum("status").notNull().default("registered"),
  reviewNotes: text("review_notes"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  publicProfile: boolean("public_profile").notNull().default(false),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("doctor_user_uq").on(t.userId), uniqueIndex("doctor_bmdc_uq").on(t.bmdcNumber), index("doctor_status_idx").on(t.status)]);

/** Append-only (enforced by DB trigger in migration 0001). Never store clinical content here. */
export const auditEvents = pgTable("audit_events", {
  id: id(),
  actorId: uuid("actor_id"),
  organizationId: uuid("organization_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  ip: text("ip"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("audit_actor_idx").on(t.actorId, t.createdAt), index("audit_action_idx").on(t.action), index("audit_org_idx").on(t.organizationId, t.createdAt)]);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
});

export const credentialStatusEnum = pgEnum("credential_status", ["pending", "verified", "rejected", "expired"]);

/** Uploaded credential evidence (BMDC certificate, degree). `storageKey` points to private object storage; never a public URL. */
export const doctorCredentials = pgTable("doctor_credentials", {
  id: id(),
  doctorId: uuid("doctor_id").notNull().references(() => doctorProfiles.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  status: credentialStatusEnum("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  reviewNotes: text("review_notes"),
  createdAt: createdAt(),
}, (t) => [index("cred_doctor_idx").on(t.doctorId), index("cred_expiry_idx").on(t.expiresAt)]);

/** In-app notification/outbox. Delivery channels (email/SMS/WhatsApp) consume `status='queued'` rows in a later milestone. */
export const notifications = pgTable("notifications", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  channel: text("channel").notNull().default("in_app"),
  status: text("status").notNull().default("queued"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [index("notif_user_idx").on(t.userId, t.createdAt), index("notif_status_idx").on(t.status)]);

/** PHI notes: phone/email/address/emergency contact are AES-GCM encrypted (`*_enc`); phone is matched via keyed blind index `phone_idx`. */
export const patients = pgTable("patients", {
  id: id(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  patientCode: text("patient_code").notNull(),
  fullName: text("full_name").notNull(),
  fullNameNorm: text("full_name_norm").notNull(),
  dob: date("dob", { mode: "string" }).notNull(),
  sex: text("sex").notNull().default("unknown"),
  phoneEnc: text("phone_enc"),
  phoneIdx: text("phone_idx"),
  emailEnc: text("email_enc"),
  addressEnc: text("address_enc"),
  emergencyContactEnc: text("emergency_contact_enc"),
  userId: uuid("user_id").references(() => users.id),
  status: text("status").notNull().default("active"),
  mergedIntoId: uuid("merged_into_id"),
  isTest: boolean("is_test").notNull().default(false),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("patients_code_uq").on(t.patientCode),
  uniqueIndex("patients_user_uq").on(t.userId),
  index("patients_org_name_idx").on(t.organizationId, t.fullNameNorm),
  index("patients_phone_idx").on(t.phoneIdx),
  index("patients_dob_idx").on(t.dob),
]);

export const patientDoctorRelationships = pgTable("patient_doctor_relationships", {
  id: id(),
  patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  doctorUserId: uuid("doctor_user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),
  reason: text("reason"),
  grantedBy: uuid("granted_by").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: uuid("revoked_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("pdr_active_uq").on(t.patientId, t.doctorUserId).where(sql`${t.revokedAt} IS NULL`),
  index("pdr_doctor_idx").on(t.doctorUserId),
]);

/** Consent history: append-only. The current state per kind is the newest row. */
export const patientConsents = pgTable("patient_consents", {
  id: id(),
  patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  granted: boolean("granted").notNull(),
  method: text("method").notNull(),
  policyVersion: text("policy_version").notNull(),
  capturedBy: uuid("captured_by").notNull().references(() => users.id),
  note: text("note"),
  createdAt: createdAt(),
}, (t) => [index("consent_patient_kind_idx").on(t.patientId, t.kind, t.createdAt)]);

/** Allergies, conditions, medications, immunizations, family history. No hard deletes: use status + reason. */
export const patientClinicalItems = pgTable("patient_clinical_items", {
  id: id(),
  patientId: uuid("patient_id").notNull().references(() => patients.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  descriptionEnc: text("description_enc").notNull(),
  severity: text("severity"),
  status: text("status").notNull().default("active"),
  statusReason: text("status_reason"),
  recordedBy: uuid("recorded_by").notNull().references(() => users.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("pci_patient_kind_idx").on(t.patientId, t.kind)]);

export const patientMerges = pgTable("patient_merges", {
  id: id(),
  sourceId: uuid("source_id").notNull().references(() => patients.id),
  targetId: uuid("target_id").notNull().references(() => patients.id),
  mergedBy: uuid("merged_by").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  createdAt: createdAt(),
});
