import type { Actor } from "./rbac";

export class TenantIsolationError extends Error {
  constructor() { super("Cross-tenant access denied"); this.name = "TenantIsolationError"; }
}

/** Every org-owned resource access must pass through this check (plus org_id filters in queries). */
export function assertSameTenant(actor: Actor, resourceOrgId: string): void {
  if (!actor.orgId || actor.orgId !== resourceOrgId) throw new TenantIsolationError();
}
