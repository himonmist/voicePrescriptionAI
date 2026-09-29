import type { Role } from "./rbac";

const PUBLIC_PREFIXES = ["/login", "/register", "/api/auth", "/api/public", "/pricing", "/features", "/how-it-works", "/doctors", "/blog", "/faq", "/contact", "/about", "/privacy", "/terms", "/verify", "/_next", "/favicon"];
const AREAS: { prefix: string; roles: Role[] }[] = [
  { prefix: "/admin/cms", roles: ["super_admin", "content_manager"] },
  { prefix: "/admin/payments", roles: ["super_admin", "finance"] },
  { prefix: "/admin/support", roles: ["super_admin", "support"] },
  { prefix: "/admin", roles: ["super_admin"] },
  { prefix: "/org", roles: ["org_admin"] },
  { prefix: "/doctor", roles: ["doctor"] },
  { prefix: "/reception", roles: ["receptionist", "doctor"] },
  { prefix: "/patient", roles: ["patient"] },
];

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");

/** Coarse edge gate. Fine-grained permission checks still run in services (defence in depth). */
const MFA_ALLOWED = ["/account/security", "/api/account/mfa"];

export function decideAccess(path: string, roles: Role[] | null, opts: { mfaPending?: boolean } = {}): { allow: true } | { allow: false; redirect?: string; status: number } {
  if (path === "/" || PUBLIC_PREFIXES.some((p) => matches(path, p))) return { allow: true };
  if (roles === null) return { allow: false, redirect: path.startsWith("/api/") ? undefined : "/login", status: path.startsWith("/api/") ? 401 : 302 };
  if (opts.mfaPending && !MFA_ALLOWED.some((p) => matches(path, p))) {
    return path.startsWith("/api/") ? { allow: false, status: 403 } : { allow: false, redirect: "/account/security", status: 302 };
  }
  const area = AREAS.find((a) => matches(path, a.prefix));
  if (!area) return roles.length ? { allow: true } : { allow: false, status: 403 };
  return area.roles.some((r) => roles.includes(r)) ? { allow: true } : { allow: false, status: 403 };
}
