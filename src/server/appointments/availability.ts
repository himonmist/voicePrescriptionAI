import { z } from "zod";
import { ForbiddenError, type Actor } from "@/lib/security/rbac";
import { isValidDate, isValidTime, minutesBetween } from "@/lib/time";
import { NotFoundError, ValidationError } from "@/server/errors";

const stripTags = (s: string) => s.replace(/<[^>]*>/g, "").trim();
const text = (max: number) => z.string().max(max).transform(stripTags);
const time = z.string().refine(isValidTime, "Times must be HH:MM (24h)");

const ruleSchema = z.object({
  weekday: z.number().int().min(0).max(6), startTime: time, endTime: time,
  slotMinutes: z.number().int().min(5).max(240), bufferMinutes: z.number().int().min(0).max(120),
  mode: z.enum(["in_person", "online", "both"]), location: text(120).nullable().optional().transform((v) => v ?? null),
  maxPerDay: z.number().int().min(1).max(200).nullable().optional().transform((v) => v ?? null),
  validFrom: z.string().refine(isValidDate).nullable().optional().transform((v) => v ?? null),
  validTo: z.string().refine(isValidDate).nullable().optional().transform((v) => v ?? null),
}).refine((r) => r.endTime > r.startTime, "End time must be after start time")
  .refine((r) => minutesBetween(r.startTime, r.endTime) >= r.slotMinutes, "The session must be at least one slot long");
export type RuleInput = z.input<typeof ruleSchema>;
type Rule = z.output<typeof ruleSchema>;

const exceptionSchema = z.object({
  date: z.string().refine(isValidDate, "Invalid date"), kind: z.enum(["holiday", "block"]),
  startTime: time.optional(), endTime: time.optional(), reason: text(200).optional(),
}).refine((e) => (e.startTime === undefined) === (e.endTime === undefined), "Give both start and end time, or neither")
  .refine((e) => !e.startTime || !e.endTime || e.endTime > e.startTime, "End time must be after start time");
export type ExceptionInput = z.input<typeof exceptionSchema>;

const profileSchema = z.object({
  consultationFeeBdt: z.number().int().min(0).max(100_000).optional(), bio: text(1500).optional(),
  languages: z.array(text(30)).max(8).optional(), chamberAddress: text(300).optional(),
  consultationMode: z.enum(["in_person", "online", "both"]).optional(), publicProfile: z.boolean().optional(),
}).strict();
export type ProfileInput = z.input<typeof profileSchema>;

export interface AvailabilityRepo {
  replaceRules(doctorUserId: string, rules: Rule[]): Promise<void>;
  getRules(doctorUserId: string): Promise<unknown[]>;
  addException(doctorUserId: string, e: z.output<typeof exceptionSchema>): Promise<string>;
  removeException(doctorUserId: string, id: string): Promise<boolean>;
  getExceptions(doctorUserId: string): Promise<unknown[]>;
  updateProfile(doctorUserId: string, p: z.output<typeof profileSchema>): Promise<void>;
  audit(e: { action: string; actorId: string }): Promise<void>;
}

const MAX_PER_DAY = 4, MAX_TOTAL = 28;

export function createAvailabilityService(repo: AvailabilityRepo) {
  const requireDoctor = (a: Actor) => { if (!a.roles.includes("doctor")) throw new ForbiddenError("appointment:write"); };
  const parse = <T>(schema: z.ZodType<T, unknown>, raw: unknown): T => { const r = schema.safeParse(raw); if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? "Invalid input"); return r.data; };

  return {
    async getSchedule(actor: Actor) { requireDoctor(actor); return { rules: await repo.getRules(actor.userId), exceptions: await repo.getExceptions(actor.userId) }; },

    /** Replaces the whole weekly schedule atomically. Existing future appointments are kept (never silently cancelled). */
    async replaceSchedule(actor: Actor, raw: RuleInput[]) {
      requireDoctor(actor);
      const rules = parse(z.array(ruleSchema).max(MAX_TOTAL), raw);
      for (let d = 0; d < 7; d++) {
        const day = rules.filter((r) => r.weekday === d).sort((a, b) => a.startTime.localeCompare(b.startTime));
        if (day.length > MAX_PER_DAY) throw new ValidationError(`At most ${MAX_PER_DAY} sessions per day`);
        for (let i = 1; i < day.length; i++) if (day[i].startTime < day[i - 1].endTime) throw new ValidationError("Sessions on the same day overlap");
      }
      await repo.replaceRules(actor.userId, rules);
      await repo.audit({ action: "availability.updated", actorId: actor.userId });
    },

    async addException(actor: Actor, raw: ExceptionInput) {
      requireDoctor(actor);
      const id = await repo.addException(actor.userId, parse(exceptionSchema, raw));
      await repo.audit({ action: "availability.exception_added", actorId: actor.userId });
      return { id };
    },
    async removeException(actor: Actor, id: string) {
      requireDoctor(actor);
      if (!(await repo.removeException(actor.userId, id))) throw new NotFoundError("Exception not found");
      await repo.audit({ action: "availability.exception_removed", actorId: actor.userId });
    },

    async updateProfile(actor: Actor, raw: ProfileInput) {
      requireDoctor(actor);
      await repo.updateProfile(actor.userId, parse(profileSchema, raw));
      await repo.audit({ action: "doctor.profile_updated", actorId: actor.userId });
    },
  };
}
