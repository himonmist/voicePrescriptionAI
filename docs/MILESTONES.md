# SmartDoctorAid — Milestones & status

Each milestone ships only when: tests written first and green, server-side authz on every route, input validated, audit events for sensitive actions, docs updated, and (where there is a UI) a live-server smoke check.

Legend: **Done** = built, tested, deployed. **Partial** = core done, listed gaps remain. **Not started**. **Blocked** = needs something from the owner (account, key, decision).

_Last verified: CI green (GitHub Actions, incl. Postgres integration tests) · Vercel deployment READY · Neon migrations 0000–0012 applied · 480 automated tests (103 need a real Postgres, run in CI)._

| # | Milestone | Status | Done | Remaining / gaps |
|---|-----------|--------|------|------------------|
| M0 | Foundation | **Done** | Repo, CI (lint, tests, audit, build), Neon + Drizzle migrations, security headers/CSP, env docs, Vercel project | — |
| M1 | Auth core | **Done** | scrypt passwords, revocable JWT sessions, deny-by-default RBAC, tenant guard, DB rate limits, lockout, append-only audit log, CSRF origin check | — |
| M2 | Accounts, MFA, public site | **Partial** | Register/login/logout, TOTP MFA + recovery codes, MFA enforced (restricted session) for admin/finance/support/content roles, route-policy proxy | **Mobile OTP** (needs SMS provider — *blocked*), **CMS + public marketing pages** (only home hero, login, register, directory exist), password reset / email verification (needs email provider — *blocked*) |
| M3 | Doctor onboarding & verification | **Partial** | Status machine (registered→…→active/suspended), atomic transitions + audit + notification, admin review UI/API, doctor dashboard | **Credential document upload** (needs object storage — *blocked*), expiry tracking, org/branch/staff admin, no admin seeded on Neon yet |
| M4 | Patient registry / EMR | **Partial** | Encrypted PHI, scoped duplicate detection, consent history, allergies/conditions/meds, doctor-to-doctor sharing (API + screen; recipients found via the public verified-doctor directory), merge, PHI-read auditing, doctor UI, patient portal for own sealed prescriptions | Receptionist UI, patient self-service beyond prescriptions/appointments, break-glass access, record export, retention/erasure workflow, encryption-key rotation |
| M5 | Appointments | **Partial** | Weekly availability, holidays/blocks, slot engine, DB-enforced no double booking, book/cancel/reschedule (API), day-of workflow, reschedule UI (patient + doctor), public verified-doctor directory + booking UI, schedule/profile editors | Receptionist booking/reschedule UI, reminders (needs M11 delivery), pay-at-booking (M10), video join (M9), approval-required mode, non-Dhaka time zones |
| M6 | Consultation workspace | **Partial** | Idempotent start, encounter-level access, transcript (Bangla/English, flags, originals kept), 15-section note, vitals flags, immutable versions, amendments, consent gate + auto-stop on withdrawal, completion | **Audio capture + STT (M8, needs provider key — *blocked*)**, note PDF, patient-facing note view |
| M7 | Prescriptions | **Partial** | Authorized-data drug reference import + safety screening, drafting with optimistic locking, approve → password-confirmed finalize (integrity seal) → amend/cancel, DB-enforced immutability, public verification + QR, A4 print, English PDF, expiring/revocable DOB-gated share links | Drug data must be imported by you (none bundled), Bengali PDF is browser-print only, pregnancy/renal/hepatic not screened, delivery by email/SMS/WhatsApp (M11); see `docs/CLINICAL_SAFETY.md` |
| M8 | AI: STT + LLM drafting | **Not started** | — | Provider abstraction, schema-validated drafts, uncertainty flags, cost tracking. *Blocked on provider + key.* |
| M9 | Drug data, reports/OCR, telemedicine | **Not started** | — | Authorized drug reference source (*blocked*), report upload/OCR (needs storage), WebRTC video |
| M10 | Billing & payments | **Not started** | — | Plans/entitlements, SSLCommerz/bKash adapters, webhooks, invoices, refunds. *Blocked on merchant sandbox credentials.* |
| M11 | Notifications, analytics, hardening | **Not started** | — | Email/SMS/WhatsApp delivery, admin dashboards, backups/restore drills, monitoring, runbooks, pen-test, load test |

## M7 scope (prescriptions)
Built in slices, each test-first:
1. **Drug reference + safety framework** — tables and admin import for *authorized* reference data (source, version, date), duplicate-ingredient / allergy / high-risk alerts, interaction screening only from loaded data. **No drug data is bundled or invented**; with nothing loaded the UI says screening is unavailable.
2. **Prescription drafting & versions** — items with doctor-entered dose/frequency/duration (unresolved fields block finalization), immutable versions, optimistic locking.
3. **Approve → finalize (integrity seal) → amend/cancel** — finalized prescriptions are immutable; corrections create a linked new version with reason; every alert override needs a reason.
4. **Verification page + QR**, **A4 print / PDF** (Bengali via browser print), **secure share link** (expiring, revocable, DOB-verified). ✔ all four slices built.
Not in M7: email/SMS/WhatsApp delivery (M11), AI drafting (M8).

## Decisions / inputs needed from you
| Needed for | What |
|---|---|
| M2 OTP, M11 | SMS + email provider account (e.g. SSL Wireless SMS, Resend/SES) |
| M3, M9 | Object storage (S3-compatible / Vercel Blob) |
| M8 | Speech-to-text + LLM provider and API keys; data-handling/retention terms |
| M9 | An **authorized** drug database licence or source (e.g. DGDA-approved list) |
| M10 | SSLCommerz / bKash sandbox merchant credentials |
| Go-live | Custom domain, Vercel deployment-protection off, Neon password rotation, first admin seeded, legal/clinical review |
