import type { Role } from "./rbac";
export function landingFor(roles: Role[], mfaPending = false): string {
  if (mfaPending) return "/account/security";
  if (roles.includes("super_admin")) return "/admin/doctors";
  if (roles.includes("doctor")) return "/doctor/dashboard";
  if (roles.includes("patient")) return "/patient/dashboard";
  return "/";
}
