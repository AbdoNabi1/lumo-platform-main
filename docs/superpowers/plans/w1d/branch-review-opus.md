# Wave 1d whole-branch review (Opus, per owner ruling)

Range 3b4dc994..74bb2353. Integration seams checked: security use cases → SecurityController → StaffAdminController → staff-routes → lib/api/staff.ts → page/actions; public accept routes ↔ accept-invite submit; LiveStaffAccessControl single instance in both guards, invalidated by staff writes.
Security: tenant only from context; actor re-checked under the per-tenant advisory lock; invite tokens hashed (sha256), single-use, rotated on resend, dead on revoke/accept; no credential before acceptance, so password reset cannot touch an invite; owner-only resources for non-owner staff; public principal untouched; responses never carry tokens/hashes.
CI at 48b69fe8: 13/13 green incl. gated staff suites on Postgres (parallel cross-demotion, double accept) and the lint cap.
Safe to deploy with the email provider env UNSET: YES (invite answers 503 NOT_CONFIGURED, nothing written; everything else works).
Migration additive and safe on the live DB: YES (one new table, RLS forced, no changes to existing tables).
Owner before release: apply 20261126000000_staff_invitations on Supabase; for invitations set RESEND_API_KEY, EMAIL_FROM, ADMIN_PUBLIC_URL.
VERDICT: APPROVED
