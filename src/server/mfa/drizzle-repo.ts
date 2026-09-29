import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { auditEvents, sessions, userRecoveryCodes, users } from "@/db/schema";
import { decryptField, encryptField } from "@/lib/security/crypto";
import type { MfaRepo } from "./service";

export function drizzleMfaRepo(db: Db = getDb()): MfaRepo {
  return {
    async state(id) {
      const [u] = await db.select({ s: users.mfaSecretEnc, e: users.mfaEnabledAt }).from(users).where(eq(users.id, id)).limit(1);
      return { hasSecret: !!u?.s, enabled: !!u?.e };
    },
    async pendingSecret(id) {
      const [u] = await db.select({ s: users.mfaSecretEnc }).from(users).where(eq(users.id, id)).limit(1);
      return u?.s ? decryptField(u.s) : null;
    },
    async setPendingSecret(id, secret) {
      await db.update(users).set({ mfaSecretEnc: encryptField(secret), mfaEnabledAt: null, updatedAt: new Date() }).where(eq(users.id, id));
    },
    async enable(id) { await db.update(users).set({ mfaEnabledAt: new Date(), updatedAt: new Date() }).where(eq(users.id, id)); },
    async disable(id) {
      await db.transaction(async (tx) => {
        await tx.update(users).set({ mfaSecretEnc: null, mfaEnabledAt: null, updatedAt: new Date() }).where(eq(users.id, id));
        await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, id));
      });
    },
    async replaceRecoveryCodes(id, hashes) {
      await db.transaction(async (tx) => {
        await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, id));
        await tx.insert(userRecoveryCodes).values(hashes.map((codeHash) => ({ userId: id, codeHash })));
      });
    },
    async passwordHash(id) {
      const [u] = await db.select({ h: users.passwordHash }).from(users).where(eq(users.id, id)).limit(1);
      return u?.h ?? null;
    },
    async revokeAllSessions(id) { await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, id), isNull(sessions.revokedAt))); },
    async audit(e) { await db.insert(auditEvents).values({ action: e.action, actorId: e.actorId, resourceType: "user", resourceId: e.actorId }); },
  };
}
