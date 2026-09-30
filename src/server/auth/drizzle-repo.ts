import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { auditEvents, doctorProfiles, organizationMemberships, sessions, userRecoveryCodes, userRoles, users } from "@/db/schema";
import { decryptField } from "@/lib/security/crypto";
import type { AuthRepo } from "./service";

const MAX_FAILS = 5, LOCK_MS = 15 * 60_000;

export function drizzleAuthRepo(db: Db = getDb()): AuthRepo {
  return {
    async findUserByEmail(email) {
      const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return u ? { id: u.id, email: u.email, passwordHash: u.passwordHash, failedLogins: u.failedLogins, lockedUntil: u.lockedUntil, disabledAt: u.disabledAt } : null;
    },
    async createUser(u) {
      return db.transaction(async (tx) => {
        const [row] = await tx.insert(users).values({ email: u.email, fullName: u.fullName, phone: u.phone, passwordHash: u.passwordHash }).returning();
        await tx.insert(userRoles).values(u.roles.map((role) => ({ userId: row.id, role })));
        return { id: row.id, email: row.email, passwordHash: row.passwordHash, failedLogins: 0, lockedUntil: null, disabledAt: null };
      });
    },
    async createDoctorProfile(p) {
      await db.insert(doctorProfiles).values({ userId: p.userId, bmdcNumber: p.bmdcNumber, specialty: p.specialty, status: "registered" });
    },
    async recordFailedLogin(id) {
      // Atomic increment; lock when threshold reached.
      const [r] = await db.update(users).set({
        failedLogins: sql`${users.failedLogins} + 1`,
        lockedUntil: sql`CASE WHEN ${users.failedLogins} + 1 >= ${MAX_FAILS} THEN now() + (${LOCK_MS} || ' milliseconds')::interval ELSE ${users.lockedUntil} END`,
      }).where(eq(users.id, id)).returning({ n: users.failedLogins });
      return r.n;
    },
    async resetFailedLogins(id) { await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, id)); },
    async createSession(s) {
      const [r] = await db.insert(sessions).values({ userId: s.userId, expiresAt: s.expiresAt, ip: s.ip, refreshHash: crypto.randomUUID() }).returning({ id: sessions.id });
      return r.id;
    },
    async isSessionActive(id) {
      const [r] = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, id), sql`${sessions.revokedAt} IS NULL`, sql`${sessions.expiresAt} > now()`)).limit(1);
      return !!r;
    },
    async revokeSession(id) { await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, id)); },
    async rolesFor(id) { return (await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, id))).map((r) => r.role); },
    async consumeRecoveryCode(userId, codeHash) {
      const r = await db.update(userRecoveryCodes).set({ usedAt: new Date() })
        .where(and(eq(userRecoveryCodes.userId, userId), eq(userRecoveryCodes.codeHash, codeHash), sql`${userRecoveryCodes.usedAt} IS NULL`)).returning({ id: userRecoveryCodes.id });
      return r.length > 0;
    },
    async primaryOrgFor(id) {
      const [m] = await db.select({ o: organizationMemberships.organizationId }).from(organizationMemberships).where(eq(organizationMemberships.userId, id)).orderBy(organizationMemberships.createdAt).limit(1);
      if (m) return m.o;
      const [d] = await db.select({ o: doctorProfiles.organizationId }).from(doctorProfiles).where(eq(doctorProfiles.userId, id)).limit(1);
      return d?.o ?? null;
    },
    async isTestAccount(id) { const [r] = await db.select({ t: users.isTestAccount }).from(users).where(eq(users.id, id)).limit(1); return r?.t === true; },
    async mfaSecretFor(id) {
      const [r] = await db.select({ enc: users.mfaSecretEnc, at: users.mfaEnabledAt }).from(users).where(eq(users.id, id)).limit(1);
      return r?.enc && r.at ? decryptField(r.enc) : null;
    },
    async audit(e) {
      await db.insert(auditEvents).values({ action: e.action, actorId: e.actorId ?? null, ip: e.ip, metadata: e.metadata ?? {} });
    },
  };
}
