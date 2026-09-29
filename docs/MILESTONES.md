# SmartDoctorAid — Milestones

Each milestone ships only when: tests written first and green, server-side authz on every route, input validated, audit events for sensitive actions, docs updated.

| # | Milestone | Status |
|---|-----------|--------|
| M0 | Foundation: repo, CI, Neon schema, security headers, migrations | **done** |
| M1 | Auth core: password hashing, JWT+revocable sessions, RBAC matrix, tenant guard, rate limiting, lockout, audit | **done** (login/register/logout routes, DB repo, proxy gate, CSRF origin check, DB rate limits, lockout) |
| M2 | TOTP MFA enforced at login (**done**); MFA enrolment UI, OTP, CMS + public site | in progress |
| M3 | Doctor verification state machine + service (**done, tested**); admin review UI/API, docs upload, org admin | in progress |
| M4 | Patient registry / EMR, consent, duplicate detection, access sharing | |
| M5 | Appointments (double-booking prevention via DB constraints), availability | |
| M6 | Consultation workspace, transcript, clinical note versions | |
| M7 | Prescription workflow, versioning, PDF (Bengali), QR verify, secure share | |
| M8 | AI: STT + LLM provider abstraction, schema-validated drafts, safety flags | |
| M9 | Drug reference, reports/OCR, telemedicine | |
| M10 | Billing: plans, entitlements, SSLCommerz/bKash adapters, webhooks, invoices | |
| M11 | Admin analytics, notifications, production hardening, runbooks | |
