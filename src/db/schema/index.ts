import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, uniqueIndex, index, pgEnum, primaryKey } from "drizzle-orm/pg-core";

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
