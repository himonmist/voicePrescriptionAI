# SmartDoctorAid — Milestones

Each milestone ships only when: tests written first and green, server-side authz on every route, input validated, audit events for sensitive actions, docs updated.

| # | Milestone | Status |
|---|-----------|--------|
| M0 | Foundation: repo, CI, Neon schema, security headers, migrations | **done** |
| M1 | Auth core: password hashing, JWT+revocable sessions, RBAC matrix, tenant guard, rate limiting, lockout, audit | **done** (login/register/logout routes, DB repo, proxy gate, CSRF origin check, DB rate limits, lockout) |
| M2 | Auth routes + TOTP MFA at login (**done**); **MFA enrolment + recovery codes + enforcement for admin roles (restricted session until enrolled; admins cannot disable) — done, tested incl. real-Postgres and live server**. Remaining: mobile OTP, CMS + public site | in progress |
| M3 | Doctor verification: state machine, atomic DB transition (audit + notification in one tx, optimistic guard), admin review page/API, doctor dashboard/submit — **done; tested incl. real-Postgres and live-server smoke**. Remaining: credential document upload (object storage), org admin | mostly done |
| M4 | Patient registry / EMR: encrypted PHI, scoped duplicate detection, consent history, clinical items (allergies etc.), doctor-to-doctor sharing, merge, PHI read auditing — service + Postgres repo + API + doctor UI. Remaining: sharing UI (needs doctor directory, M5), receptionist UI, patient-portal self-service, break-glass access, record export | mostly done |
| M5 | Appointments (double-booking prevention via DB constraints), availability | |
| M6 | Consultation workspace, transcript, clinical note versions | |
| M7 | Prescription workflow, versioning, PDF (Bengali), QR verify, secure share | |
| M8 | AI: STT + LLM provider abstraction, schema-validated drafts, safety flags | |
| M9 | Drug reference, reports/OCR, telemedicine | |
| M10 | Billing: plans, entitlements, SSLCommerz/bKash adapters, webhooks, invoices | |
| M11 | Admin analytics, notifications, production hardening, runbooks | |
