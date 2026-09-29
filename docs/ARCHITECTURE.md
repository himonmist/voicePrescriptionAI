# Architecture

**Stack:** Next.js 16 (App Router, TypeScript) on Vercel; Neon Postgres 17 (ap-southeast-1) via Drizzle ORM; Vitest (TDD); Zod validation; jose JWT.

**Deviation from brief:** NestJS is replaced by Next.js Route Handlers + a `src/server/*` service layer, because Vercel serverless deploys a single Next app cleanly. Domain logic stays framework-free (services take injected repositories) so it can be lifted into a separate API later. Redis/BullMQ are replaced initially by Postgres-backed rate limits and Vercel cron/queues.

## Layers
- `src/lib/security` — password (scrypt), session (JWT HS256 + server-side revocable session id), RBAC matrix (deny by default; super_admin has no clinical permissions), tenant guard, rate limiter.
- `src/server/*` — services with injected repos (unit-tested with fakes).
- `src/db` — Drizzle schema + client; migrations in `drizzle/` (audit_events is append-only via DB trigger).
- `src/app` — UI and route handlers; authz is enforced in services, never only in the UI.

## Environment notes
Neon hosts are not reachable from the Claude sandbox egress policy; migrations were applied via Neon MCP and recorded in `drizzle.__drizzle_migrations`. DB integration tests run in CI / locally with `TEST_DATABASE_URL`.

## Clinical safety
AI output is always draft; only a doctor role can sign (`prescription:sign`); no mock AI in place of a provider. See spec §24.

## Patient records (M4) — access model
Single source of truth: `src/server/patients/access.ts` (`accessLevel`), deny by default.

| Actor | Access |
|---|---|
| Treating doctor (active relationship, verified `active` doctor) | clinical |
| Doctor with an unexpired, unrevoked **share** from the treating doctor | clinical |
| Doctor in the same org, no relationship | none (404 — existence not revealed) |
| Receptionist, same org | demographics only |
| Patient | own linked record |
| super_admin, org_admin, support, finance, content_manager | none |

- Suspension/un-verification of a doctor removes access on the next request (status is re-checked, not cached in the token).
- Only a treating doctor may share (reason + expiry ≤ 90 days, recipient must be an active doctor); shared doctors cannot re-share; either side can end a share.
- Duplicate detection only compares against patients the caller can already see, so it cannot be used to discover other doctors' patients. A shared phone alone is never a strong match (families share numbers).
- PHI at rest: phone, email, address, emergency contact, clinical item text are AES-256-GCM encrypted; phone search uses a keyed HMAC blind index (key derived from `FIELD_ENCRYPTION_KEY`). Name and date of birth are stored in clear for search/dedupe — a documented trade-off. **Losing or rotating `FIELD_ENCRYPTION_KEY` makes encrypted fields unreadable; key rotation tooling is not built yet.**
- Every record read writes a `patient.viewed` audit event; audit metadata never contains PHI.
- Clinical items are never deleted — resolved / entered-in-error with a reason. Consent is an append-only history; absence of a record means no consent (`hasActiveConsent` is the gate the consultation module must use before recording).
- Not built yet: break-glass emergency access (needs reason + second approver + expiry), patient data export, retention/deletion workflow.

## Testing
- `npm test` runs unit + API-handler tests. Integration tests (`tests/integration`) run against a real Postgres when `TEST_DATABASE_URL` is set (CI uses a `postgres:17` service container; locally any throwaway DB) and are skipped otherwise. They apply the real migrations and cover: unique constraints, transactional rollback, atomic lockout counter, append-only audit trigger, DB rate limiter under concurrency, verification workflow with concurrent decisions.
- The DB client uses the Neon serverless driver for `*.neon.tech` hosts and node-postgres otherwise, so the app runs locally without Neon.
- Local first admin: `SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run db:seed`.
