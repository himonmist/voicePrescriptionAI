# Clinical safety rules (as implemented)

These are engineering guarantees, not regulatory claims. Nothing here is a medical-device certification or a legal e-signature.

1. **AI never signs or finalizes.** Only a verified, active doctor can approve and finalize, and finalizing re-asks for their password (rate limited). AI-drafted content (M8) will always be labelled `ai_draft` and needs doctor approval.
2. **Nothing clinical is invented.** No drug data is bundled. Drug/interaction screening runs only on reference data imported from an authorized source by the platform owner; with nothing loaded the UI says screening is unavailable. Missing information stays missing (`not_documented`); unresolved dose/frequency/duration blocks finalization.
3. **Screening is decision support.** Every result lists what was *not* screened (`limits`): pregnancy status is unknown, renal/hepatic function is not screened, and interactions only cover loaded data. A doctor must give a written reason to override an alert.
4. **Finalized documents are immutable.** DB triggers reject edits to a finalized prescription and its versions. Corrections create a new linked version (the original becomes *superseded*, with a reason); cancellation needs a reason. Nothing is silently overwritten.
5. **Integrity seal.** SHA-256 over canonical content + an Ed25519 platform signature. It proves the content is unchanged since sealing and was issued through this platform. It is **not** a CA-issued digital signature.
6. **Public verification shows no PHI** — issuer, BMDC number, date, status and integrity only.
7. **Share links** are for finalized prescriptions only: 256-bit token stored as a hash, expiry 1–30 days, revocable, recipient must enter the patient's date of birth, locks after 5 wrong attempts, indistinguishable failures, superseded/cancelled prescriptions show a notice and no content. Anyone holding both the link and the date of birth can view it — tell patients not to post it.
8. **Consent** gates recording; absence of a record means no consent.
9. **Audit** events are append-only and never contain PHI or clinical text.

## Known limits
- Server-side PDF cannot shape Bengali; Bengali prescriptions use the browser's Print → Save as PDF.
- No email/SMS/WhatsApp delivery yet (M11): the doctor copies the share link.
- Legal/clinical review of wording, and any regulatory position, remain the owner's responsibility before real patients are served.
