# Deployment

- **Vercel project:** `smartdoctoraid` (`prj_xhG1qUIXWRViDlH7ebabWE0Pasiv`), linked to GitHub; region `sin1`.
- **Neon project:** `smartdoctoraid` (`damp-hall-33007887`, Postgres 17, ap-southeast-1).
- **Env vars (Vercel, type=sensitive):** `DATABASE_URL`, `AUTH_SECRET`, `FIELD_ENCRYPTION_KEY`. Production secrets are distinct from local `.env`.
- Vercel Authentication (SSO protection) is ON by default for deployments; disable/adjust in project settings when ready for public access.
- Migrations: `npm run db:migrate` from an environment that can reach Neon (CI or laptop). Applied so far: 0000_init, 0001_audit_append_only.
- Rotate the Neon role password before real users: it was displayed in a tool session during setup.
