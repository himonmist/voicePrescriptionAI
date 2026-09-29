export const ROLES = ["super_admin", "org_admin", "doctor", "receptionist", "patient", "support", "finance", "content_manager"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "doctor:verify" | "org:manage" | "user:manage" | "plan:manage" | "settings:manage" | "audit:read"
  | "cms:write" | "ticket:manage" | "payment:read" | "refund:manage"
  | "patient:read" | "patient:write" | "appointment:write" | "appointment:read"
  | "consultation:write" | "consultation:read" | "prescription:write" | "prescription:sign"
  | "prescription:read_own" | "appointment:book_own" | "report:read_own" | "consent:manage_own"
  | "report:upload" | "usage:read_own";

const P = (...p: Permission[]) => new Set<Permission>(p);

/** Deny-by-default matrix. Super admin intentionally has NO clinical permissions (spec §3A). */
export const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  super_admin: P("doctor:verify", "org:manage", "user:manage", "plan:manage", "settings:manage", "audit:read", "cms:write", "ticket:manage", "payment:read", "refund:manage"),
  org_admin: P("org:manage", "user:manage", "appointment:read", "usage:read_own", "audit:read"),
  doctor: P("patient:read", "patient:write", "appointment:read", "appointment:write", "consultation:read", "consultation:write", "prescription:write", "prescription:sign", "report:upload", "usage:read_own"),
  receptionist: P("patient:read", "patient:write", "appointment:read", "appointment:write"),
  patient: P("prescription:read_own", "appointment:book_own", "report:read_own", "consent:manage_own"),
  support: P("ticket:manage"),
  finance: P("payment:read", "refund:manage"),
  content_manager: P("cms:write"),
};

export interface Actor { userId: string; roles: Role[]; orgId: string | null; /** Privileged user who has not enrolled MFA yet: session is restricted to the enrolment flow. */ mfaPending?: boolean }

/** Roles that must use MFA (spec §23). */
export const PRIVILEGED_ROLES: Role[] = ["super_admin", "org_admin", "finance", "support", "content_manager"];
export const isPrivileged = (roles: Role[]) => roles.some((r) => PRIVILEGED_ROLES.includes(r));

export class ForbiddenError extends Error {
  constructor(public permission: Permission) { super(`Forbidden: ${permission}`); this.name = "ForbiddenError"; }
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.roles.some((r) => ROLE_PERMISSIONS[r]?.has(permission));
}

export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new ForbiddenError(permission);
}
