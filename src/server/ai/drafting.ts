import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import type { RateResult } from "@/lib/security/rate-limit";
import { NotFoundError, UnavailableError, ValidationError } from "@/server/errors";
import type { AccessLevel } from "@/server/patients/access";
import type { ConsultRepo } from "@/server/consultations/service";
import { buildUserPrompt, draftSchema, extractJson, groundDraft, mergeIntoExisting, SYSTEM_PROMPT } from "./draft";
import type { LlmProvider } from "./provider";

export interface UsageInput { kind: string; consultationId: string; userId: string; provider: string; model: string; status: "ok" | "failed" | "rejected"; inputTokens: number; outputTokens: number; latencyMs: number }
export interface DraftingDeps {
  provider: LlmProvider | null;
  patientAccess(actor: Actor, patientId: string): Promise<AccessLevel>;
  hasConsent(patientId: string, kind: "recording" | "ai_processing"): Promise<boolean>;
  limiter: { hit(key: string, limit: number, windowMs: number): RateResult | Promise<RateResult> };
  recordUsage(u: UsageInput): Promise<void>;
  now?: () => number;
}
const MAX_TRANSCRIPT_CHARS = 60_000;

export function createDraftingService(repo: ConsultRepo, deps: DraftingDeps) {
  const now = deps.now ?? Date.now;
  return {
    /** Whether AI drafting is configured — safe to show in the UI. */
    available: () => deps.provider !== null,

    /**
     * Drafts note sections from the transcript. The result is a DRAFT: sections carry origin "ai_draft" with source segment ids,
     * doctor-written sections are never overwritten, and nothing is approved. Failures save nothing.
     */
    async draftNote(actor: Actor, consultationId: string) {
      const c = await repo.get(consultationId);
      if (!c || !actor.roles.includes("doctor")) throw new NotFoundError("Consultation not found");
      if ((await deps.patientAccess(actor, c.patientId)) !== "clinical") throw new NotFoundError("Consultation not found");
      if (c.doctorUserId !== actor.userId) throw new ForbiddenError("consultation:write");
      if (c.status !== "in_progress") throw new ValidationError("This consultation is not open");
      const provider = deps.provider;
      if (!provider) throw new UnavailableError("AI drafting is not configured on this server");
      if (!(await deps.hasConsent(c.patientId, "ai_processing"))) throw new ValidationError("The patient has not consented to AI processing of the transcript. Record consent first, or write the note manually.");
      const existing = await repo.getNote(consultationId);
      if (existing?.status === "approved") throw new ValidationError("The note is approved; AI drafting cannot change it");
      const rl = await deps.limiter.hit(`ai-draft:${actor.userId}`, 10, 3_600_000);
      if (!rl.allowed) throw new ValidationError("AI drafting limit reached (10 per hour). Try again later.");
      const segments = await repo.listSegments(consultationId);
      const lines = segments.map((s) => ({ id: s.id, speaker: s.speaker, text: s.text }));
      if (lines.length === 0) throw new ValidationError("There is no transcript to draft from");
      if (lines.reduce((n, l) => n + l.text.length, 0) > MAX_TRANSCRIPT_CHARS) throw new ValidationError("The transcript is too long to draft in one go");

      const started = now();
      const usage = (status: UsageInput["status"], i = 0, o = 0) => deps.recordUsage({ kind: "note_draft", consultationId, userId: actor.userId, provider: provider.name, model: provider.model, status, inputTokens: i, outputTokens: o, latencyMs: now() - started });
      let res;
      try { res = await provider.complete({ system: SYSTEM_PROMPT, user: buildUserPrompt(lines), maxTokens: 4000 }); }
      catch { await usage("failed"); await repo.audit({ action: "note.ai_draft_failed", actorId: actor.userId, organizationId: actor.orgId, resourceId: consultationId }); throw new UnavailableError("The AI service did not respond. Nothing was changed."); }
      let raw;
      try { raw = draftSchema.parse(extractJson(res.text)); }
      catch { await usage("rejected", res.inputTokens, res.outputTokens); await repo.audit({ action: "note.ai_draft_rejected", actorId: actor.userId, organizationId: actor.orgId, resourceId: consultationId }); throw new UnavailableError("The AI returned an unusable draft. Nothing was changed."); }

      const grounded = groundDraft(raw, lines);
      const { content, filled, skipped } = mergeIntoExisting(existing?.content ?? null, grounded.content);
      await usage("ok", res.inputTokens, res.outputTokens);
      if (filled.length === 0 && grounded.content.diagnoses.length === 0 && !grounded.content.vitals) {
        return { saved: false as const, version: existing?.currentVersion ?? 0, filled, skipped, dropped: grounded.dropped, uncertain: grounded.uncertain };
      }
      const { version } = await repo.saveVersion({ consultationId, baseVersion: existing?.currentVersion ?? 0, content, authorId: actor.userId, kind: "edit", summary: "AI draft — unreviewed" });
      await repo.audit({ action: "note.ai_drafted", actorId: actor.userId, organizationId: actor.orgId, resourceId: consultationId, metadata: { version, filled: filled.length, dropped: grounded.dropped.length } });
      return { saved: true as const, version, filled, skipped, dropped: grounded.dropped, uncertain: grounded.uncertain };
    },
  };
}
