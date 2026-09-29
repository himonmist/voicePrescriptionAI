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
