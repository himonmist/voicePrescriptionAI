# SmartDoctorAid — Milestones

Each milestone ships only when: tests written first and green, server-side authz on every route, input validated, audit events for sensitive actions, docs updated.

| # | Milestone | Status |
|---|-----------|--------|
| M0 | Foundation: repo, CI, Neon schema, security headers, migrations | **done** |
| M1 | Auth core: password hashing, JWT+revocable sessions, RBAC matrix, tenant guard, rate limiting, lockout, audit | **done** (login/register/logout routes, DB repo, proxy gate, CSRF origin check, DB rate limits, lockout) |
| M2 | Auth routes + TOTP MFA at login (**done**); **MFA enrolment + recovery codes + enforcement for admin roles (restricted session until enrolled; admins cannot disable) — done, tested incl. real-Postgres and live server**. Remaining: mobile OTP, CMS + public site | in progress |
| M3 | Doctor verification: state machine, atomic DB transition (audit + notification in one tx, optimistic guard), admin review page/API, doctor dashboard/submit — **done; tested incl. real-Postgres and live-server smoke**. Remaining: credential document upload (object storage), org admin | mostly done |
| M4 | Patient registry / EMR: encrypted PHI, scoped duplicate detection, consent history, clinical items (allergies etc.), doctor-to-doctor sharing, merge, PHI read auditing — service + Postgres repo + API + doctor UI. Remaining: sharing UI (needs doctor directory, M5), receptionist UI, patient-portal self-service, break-glass access, record export | mostly done |
| M5 | Appointments: availability rules (weekly sessions, buffers, breaks, holidays, daily caps), slot engine, DB-enforced no-double-booking (Postgres EXCLUDE constraints), booking/cancel/reschedule with cutoff policy, day-of check-in/no-show workflow, public verified-doctor directory + profile + booking UI, doctor schedule & profile editors — **done; tested incl. 12-way concurrent booking race on real Postgres and live server**. Not built: online payment at booking (M10), reminders/delivery (M11), video join (M9), booking-approval mode, recurring follow-ups, reschedule UI (API done), receptionist booking UI (API done) | done (see gaps) |
| M6 | Consultation workspace (no AI): idempotent start from a checked-in appointment or as a walk-in (DB-unique, race-tested), author-only access with approved-note read for shared doctors, allergy banner, editable Bangla/English transcript with speaker + timestamps + uncertainty flags + preserved originals, structured clinical note (15 sections, vitals with review flags, provisional vs doctor-confirmed diagnoses) with immutable versions, optimistic locking, explicit approval and reason-required amendments, recording-consent gate (start/resume, auto-stop on withdrawal), one-transaction completion — **done; 337+ tests, real-Postgres concurrency tests, live smoke script `scripts/smoke/consultation.sh`**. Not built: audio capture/storage and live STT (M8, needs a provider), drafts from AI, patient-facing note view, note PDF | done (see gaps) |
| M7 | Prescription workflow, versioning, PDF (Bengali), QR verify, secure share | |
| M8 | AI: STT + LLM provider abstraction, schema-validated drafts, safety flags | |
| M9 | Drug reference, reports/OCR, telemedicine | |
| M10 | Billing: plans, entitlements, SSLCommerz/bKash adapters, webhooks, invoices | |
| M11 | Admin analytics, notifications, production hardening, runbooks | |
