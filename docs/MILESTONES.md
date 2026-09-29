# SmartDoctorAid — Milestones

Each milestone ships only when: tests written first and green, server-side authz on every route, input validated, audit events for sensitive actions, docs updated.

| # | Milestone | Status |
|---|-----------|--------|
| M0 | Foundation: repo, CI, Neon schema, security headers, migrations | **done** |
| M1 | Auth core: password hashing, JWT+revocable sessions, RBAC matrix, tenant guard, rate limiting, lockout, audit | **service+tests done; API routes/UI next** |
| M2 | Auth API routes, MFA for privileged roles, OTP, CMS + public site | next |
| M3 | Doctor onboarding & verification workflow, org/tenant admin | |
| M4 | Patient registry / EMR, consent, duplicate detection, access sharing | |
| M5 | Appointments (double-booking prevention via DB constraints), availability | |
| M6 | Consultation workspace, transcript, clinical note versions | |
| M7 | Prescription workflow, versioning, PDF (Bengali), QR verify, secure share | |
| M8 | AI: STT + LLM provider abstraction, schema-validated drafts, safety flags | |
| M9 | Drug reference, reports/OCR, telemedicine | |
| M10 | Billing: plans, entitlements, SSLCommerz/bKash adapters, webhooks, invoices | |
| M11 | Admin analytics, notifications, production hardening, runbooks | |
