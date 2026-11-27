# Wave 1e plan review — Opus (round 1)

Reviewer: Opus (owner ruling 2026-11-24). Checked against survey-2fa.md and code at a83a0215 (Authenticate output fields, NativeTokenIssuer options, publicStaffAuthRoutes rateLimiter param, runtime MFA wiring).

- O1 BLOCKING (T1): replay/step tests cannot be expressed with InMemoryTotpMfaProvider (fixed code = current step). Fix: real TotpMfaProvider + fixed secret + fake clock. → amended.
- O2 BLOCKING (T1/T2): DisableOwnTwoStep re-verifying the password inside Security had no defined provider seam; the admin controller already re-verifies passwords via authenticate (changePassword). Fix: move the check to the controller. → amended.
- O3 BLOCKING (T1/T2): login would need an extra call to know enrolment. Fix: AuthenticateOutput.hasActiveEnrollment. → amended.
- O4 OPTIONAL (T1): audit subject for an unknown principal. → amended.
- O5 BLOCKING (T2): the verify-route tenant rule was ambiguous. Fix: staff route requires challenge tenant == request tenant; merchant route trusts the signed claim after the platform gate. → amended.
  Checked and fine: policy preconditions cover the bootstrap owner (tenantRef ?? tenantId fix + 'every active staff' includes the owner); invite/accept/reactivate blocked while on (no enrol-at-login dead end); secrets only on non-idempotent routes; challenge rejected as a session (different audience); per-principal limiter fails closed; no QR dependency (no install needed).

VERDICT: AGREED (after amendments)
