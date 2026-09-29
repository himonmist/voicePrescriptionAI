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

## Appointments (M5)
- **Time:** stored as UTC instants; working hours are Asia/Dhaka wall-clock (UTC+6, no DST — fixed offset is exact). Other time zones are not supported yet.
- **Slot engine** (`src/server/appointments/slots.ts`) is pure. The booking service re-derives the offered slots server-side and accepts only an exact offered start; the end time is always computed by the server. Clients cannot invent times.
- **No double booking:** Postgres `EXCLUDE USING gist` constraints (migration 0006, needs `btree_gist`) reject overlapping active appointments for the same doctor **and** for the same patient. The service maps SQLSTATE `23P01` to a 409. Tested with 12 simultaneous requests for one slot: exactly one succeeds.
- **Policy:** patients may cancel/reschedule online until 2 h before start (`PATIENT_CANCEL_CUTOFF_HOURS`); doctors/reception may cancel any time with a reason. Check-in only on the day; no-show only after the start time.
- **Access:** patient sees own, doctor sees own, receptionist sees own organization (without visit reasons). Booking creates the patient–doctor relationship so the doctor can open the record.
- **Public surface:** `/api/public/*` is rate limited per IP (120/min) and lists only `active` + opted-in doctors with no contact details.
- Editing a schedule never cancels existing appointments.
- Visit reason is encrypted; if it cannot be decrypted it shows as unavailable rather than failing the list. Clinical fields deliberately do NOT have this tolerance.

## Consultations (M6)
- **Creation is idempotent.** Unique constraints (one consultation per appointment; one open walk-in per doctor+patient) make concurrent/double-click starts converge on a single row. The linked appointment moves `checked_in → in_progress` in the same transaction.
- **Encounter-level access.** Only the authoring doctor (who must still be verified/active and have clinical access to the patient) can open or edit a consultation. Another doctor who holds a patient share sees only the *approved* note, never the transcript. Everyone else gets 404.
- **Transcript** text is encrypted at rest; the first original of an edited line is kept. Uncertain lines can be flagged. Locked once the consultation is completed.
- **Clinical note.** Every section is either `documented` (clinician-written text) or `not_documented`; omission is never treated as normal. Provenance is forced to `manual` server-side; only the M8 drafting path may create `ai_draft` content. Each save appends an immutable, encrypted version (DB trigger forbids UPDATE/DELETE); saves use optimistic locking on `baseVersion`. Approval is explicit; afterwards changes are `amendment` versions that require a reason, and the DB guard rejects a plain edit that races an approval.
- **Recording consent gate.** Starting or resuming a recording verifies recorded consent server-side; withdrawing consent stops any live session in the same transaction. **No audio is captured or stored yet** — there is no STT provider; the UI says so and offers manual transcript entry. `audio_sessions` records lifecycle + consent evidence only.
- Deleting patient data later will need an explicit erasure procedure: note versions are immutable by design.
- **Known limits:** no realtime collaboration; vitals flags are simple range checks, not clinical decision support.

## Testing
- `npm test` runs unit + API-handler tests. Integration tests (`tests/integration`) run against a real Postgres when `TEST_DATABASE_URL` is set (CI uses a `postgres:17` service container; locally any throwaway DB) and are skipped otherwise. They apply the real migrations and cover: unique constraints, transactional rollback, atomic lockout counter, append-only audit trigger, DB rate limiter under concurrency, verification workflow with concurrent decisions.
- The DB client uses the Neon serverless driver for `*.neon.tech` hosts and node-postgres otherwise, so the app runs locally without Neon.
- Local first admin: `SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run db:seed`.
- `scripts/smoke/consultation.sh` runs 37 assertions against a live server + disposable DB (found two bugs that unit/integration tests missed). Run it before releases: build, start on :3111, `bash scripts/smoke/consultation.sh`.
