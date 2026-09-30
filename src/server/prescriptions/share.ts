import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import { NotFoundError, ValidationError } from "@/server/errors";
import type { AccessLevel } from "@/server/patients/access";

/**
 * Secure prescription share links.
 * - The token is 256 bits of randomness, shown once; only its SHA-256 hash is stored.
 * - The recipient must also enter the patient's date of birth; 5 wrong tries lock the link.
 * - Unknown / revoked / expired / locked links are indistinguishable to the public.
 * - Only FINALIZED prescriptions can be shared. A later-superseded/cancelled one shows a notice, never content.
 */
export const MAX_LIVE_LINKS = 5;
export const MAX_FAILED_ATTEMPTS = 5;
const DAY = 86_400_000;

export class ShareUnavailableError extends Error { constructor() { super("This link is no longer valid."); this.name = "ShareUnavailableError"; } }

export interface ShareRow { id: string; prescriptionId: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null; lockedAt: Date | null; failedAttempts: number; accessCount: number; lastAccessedAt: Date | null }
export interface ShareRxLite { id: string; status: string; doctorUserId: string; patientId: string; code: string; organizationId?: string | null }
export interface ShareAudit { action: string; actorId: string | null; organizationId?: string | null; resourceId: string; metadata?: Record<string, unknown> }

export interface ShareRepo {
  prescription(id: string): Promise<ShareRxLite | null>;
  activeCount(prescriptionId: string, now: Date): Promise<number>;
  create(i: { prescriptionId: string; tokenHash: string; expiresAt: Date; createdBy: string }): Promise<string>;
  list(prescriptionId: string): Promise<ShareRow[]>;
  revoke(prescriptionId: string, shareId: string, by: string): Promise<boolean>;
  byTokenHash(hash: string): Promise<{ share: ShareRow; rx: ShareRxLite; patientDob: string } | null>;
  /** Atomic: increments and locks at MAX_FAILED_ATTEMPTS. Returns the new count. */
  recordFailure(shareId: string): Promise<number>;
  recordAccess(shareId: string): Promise<void>;
  audit(e: ShareAudit): Promise<void>;
}

export interface SealedCopy { code: string; state: "valid" | "superseded" | "cancelled"; issuedAt: string; content: unknown; doctor: unknown; patient: { name: string; dob: string; sex: string; patientCode: string } }
export interface ShareDeps {
  now?: () => Date;
  patientAccess(actor: Actor, patientId: string): Promise<AccessLevel>;
  sealedCopy(prescriptionId: string): Promise<SealedCopy>;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;
const daysSchema = z.number().int().min(1).max(30);

function sameDob(a: string, b: string) {
  const x = Buffer.from(a.padEnd(10, "\0").slice(0, 10)); const y = Buffer.from(b.padEnd(10, "\0").slice(0, 10));
  return timingSafeEqual(x, y) && a.length === b.length;
}

export function createShareService(repo: ShareRepo, deps: ShareDeps) {
  const now = deps.now ?? (() => new Date());
  const audit = (a: Actor, action: string, id: string, metadata: Record<string, unknown> = {}) => repo.audit({ action, actorId: a.userId, organizationId: a.orgId, resourceId: id, metadata });

  async function loadAuthor(actor: Actor, id: string) {
    if (!actor.roles.includes("doctor")) throw new ForbiddenError("prescription:write");
    const rx = await repo.prescription(id);
    if (!rx || rx.doctorUserId !== actor.userId) throw new NotFoundError("Prescription not found");
    if ((await deps.patientAccess(actor, rx.patientId)) !== "clinical") throw new NotFoundError("Prescription not found");
    return rx;
  }

  return {
    async createLink(actor: Actor, id: string, input: { expiresInDays?: unknown }) {
      const d = daysSchema.safeParse(input.expiresInDays ?? 7);
      if (!d.success) throw new ValidationError("Expiry must be a whole number of days between 1 and 30");
      const rx = await loadAuthor(actor, id);
      if (rx.status !== "finalized") throw new ValidationError("Only a finalized prescription can be shared");
      if ((await repo.activeCount(id, now())) >= MAX_LIVE_LINKS) throw new ValidationError(`At most ${MAX_LIVE_LINKS} active links per prescription — revoke one first`);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now().getTime() + d.data * DAY);
      const shareId = await repo.create({ prescriptionId: id, tokenHash: sha256(token), expiresAt, createdBy: actor.userId });
      await audit(actor, "prescription.share_created", id, { shareId, expiresInDays: d.data });
      return { shareId, token, expiresAt };
    },

    async listLinks(actor: Actor, id: string) {
      await loadAuthor(actor, id);
      const t = now();
      return (await repo.list(id)).map((s) => ({ id: s.id, createdAt: s.createdAt, expiresAt: s.expiresAt, revoked: !!s.revokedAt, locked: !!s.lockedAt, expired: s.expiresAt <= t, accessCount: s.accessCount, lastAccessedAt: s.lastAccessedAt, failedAttempts: s.failedAttempts }));
    },

    async revokeLink(actor: Actor, id: string, shareId: string) {
      await loadAuthor(actor, id);
      if (!(await repo.revoke(id, shareId, actor.userId))) throw new NotFoundError("Link not found");
      await audit(actor, "prescription.share_revoked", id, { shareId });
    },

    /** PUBLIC. Token + patient DOB. Never reveals which check failed or whether a link ever existed. */
    async open(token: string, dob: string): Promise<{ state: "valid" | "superseded" | "cancelled"; copy?: SealedCopy }> {
      if (typeof token !== "string" || !TOKEN_RE.test(token)) throw new ShareUnavailableError();
      const found = await repo.byTokenHash(sha256(token));
      if (!found) throw new ShareUnavailableError();
      const { share, rx, patientDob } = found; const t = now();
      if (share.revokedAt || share.lockedAt || share.expiresAt <= t) throw new ShareUnavailableError();
      const given = typeof dob === "string" ? dob.trim() : "";
      if (!DOB_RE.test(given) || !sameDob(given, patientDob)) {
        await repo.recordFailure(share.id);
        await repo.audit({ action: "prescription.share_failed", actorId: null, resourceId: rx.id, metadata: { shareId: share.id } });
        throw new ValidationError("The details you entered don't match our records");
      }
      if (rx.status === "superseded" || rx.status === "cancelled") {
        await repo.recordAccess(share.id);
        return { state: rx.status };
      }
      if (rx.status !== "finalized") throw new ShareUnavailableError();
      const copy = await deps.sealedCopy(rx.id);
      await repo.recordAccess(share.id);
      await repo.audit({ action: "prescription.share_opened", actorId: null, resourceId: rx.id, metadata: { shareId: share.id } });
      return { state: "valid", copy };
    },
  };
}
