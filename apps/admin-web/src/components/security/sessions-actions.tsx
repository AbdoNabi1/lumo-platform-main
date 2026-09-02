"use client";

import { useActionState, useId, useState } from "react";
import { AlertTriangleIcon, CheckIcon, CopyIcon } from "lucide-react";
import { Badge, Button, Input, Label } from "@platform/ui";
import {
  authenticateAction,
  blockDeviceAction,
  decideMfaAction,
  enrollMfaAction,
  establishSessionAction,
  evaluateRiskAction,
  generateBackupCodesAction,
  recordDeviceSignalAction,
  refreshSessionAction,
  registerAuthMethodAction,
  registerDeviceAction,
  registerMfaMethodAction,
  revokeAllSessionsAction,
  revokeMfaAction,
  revokeSessionAction,
  trustDeviceAction,
  verifyMfaEnrollmentAction,
  type AuthenticateFormState,
  type DecideMfaFormState,
  type EvaluateRiskFormState,
  type GenerateBackupCodesFormState,
} from "@/app/security/sessions/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };
const AUTHENTICATE_INITIAL_STATE: AuthenticateFormState = { status: "idle" };
const BACKUP_CODES_INITIAL_STATE: GenerateBackupCodesFormState = { status: "idle" };
const DECIDE_MFA_INITIAL_STATE: DecideMfaFormState = { status: "idle" };
const EVALUATE_RISK_INITIAL_STATE: EvaluateRiskFormState = { status: "idle" };

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out";

function ErrorBanner({ message }: { readonly message: string }) {
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
    >
      <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

// ── Sessions ─────────────────────────────────────────────────────────────────────────────────────

/** "Establish session" (T5.12e) — a standalone create form. */
export function EstablishSessionForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(establishSessionAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securitySessionsPage.establishSession.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securitySessionsPage.establishSession.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-principalExternalId`}
          name="principalExternalId"
          label={t.securitySessionsPage.establishSession.principalExternalId}
          error={fieldErrors["principalExternalId"]}
        />
        <Field
          id={`${formId}-refreshFingerprint`}
          name="refreshFingerprint"
          label={t.securitySessionsPage.establishSession.refreshFingerprint}
          error={fieldErrors["refreshFingerprint"]}
        />
        <Field
          id={`${formId}-ttlSeconds`}
          name="ttlSeconds"
          label={t.securitySessionsPage.establishSession.ttlSeconds}
          error={fieldErrors["ttlSeconds"]}
          type="number"
          min={1}
        />
        <Field
          id={`${formId}-externalRef`}
          name="externalRef"
          label={t.securitySessionsPage.establishSession.externalRef}
        />
        <Field
          id={`${formId}-deviceRef`}
          name="deviceRef"
          label={t.securitySessionsPage.establishSession.deviceRef}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securitySessionsPage.establishSession.submitting
            : t.securitySessionsPage.establishSession.submit}
        </Button>
      </div>
    </form>
  );
}

/** Rotates the refresh token and extends a session — a per-row control on the session explorer. */
export function RefreshSessionRowForm({ sessionId, t }: { readonly sessionId: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(refreshSessionAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="sessionId" value={sessionId} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Label htmlFor={`${formId}-newRefreshFingerprint`} className="sr-only">
          {t.securitySessionsPage.sessionActions.refresh.newRefreshFingerprint}
        </Label>
        <Input
          id={`${formId}-newRefreshFingerprint`}
          name="newRefreshFingerprint"
          placeholder={t.securitySessionsPage.sessionActions.refresh.newRefreshFingerprint}
          className="h-8 w-28 text-xs"
        />
        <Label htmlFor={`${formId}-ttlSeconds`} className="sr-only">
          {t.securitySessionsPage.sessionActions.refresh.ttlSeconds}
        </Label>
        <Input
          id={`${formId}-ttlSeconds`}
          name="ttlSeconds"
          type="number"
          min={1}
          placeholder={t.securitySessionsPage.sessionActions.refresh.ttlSeconds}
          className="h-8 w-20 text-xs"
        />
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securitySessionsPage.sessionActions.refresh.submitting
            : t.securitySessionsPage.sessionActions.refresh.submit}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

/**
 * Revokes a single session — the literal "session revocation" control, a per-row control on the
 * session explorer. Confirmed before submit (constraint #10).
 */
export function RevokeSessionRowForm({ sessionId, t }: { readonly sessionId: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(revokeSessionAction, INITIAL_STATE);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.securitySessionsPage.sessionActions.revoke.confirm)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="sessionId" value={sessionId} />
      <Button type="submit" size="sm" variant="destructive" loading={isPending} disabled={isPending}>
        {isPending
          ? t.securitySessionsPage.sessionActions.revoke.submitting
          : t.securitySessionsPage.sessionActions.revoke.submit}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

/**
 * "Force logout everywhere" for a principal (T5.12e) — the plan's single highest-blast-radius
 * control in this part. Confirmed with an explicit dialog naming the exact `principalExternalId`
 * typed into the form and stating the full blast radius — not the generic "are you sure?" text
 * every other destructive control on this screen uses, per the task brief's explicit call-out for
 * this one action (same treatment `EmergencyRevokeCredentialsForm`, T5.12c, gives its own single
 * highest-blast-radius action).
 */
export function RevokeAllSessionsForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(revokeAllSessionsAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const formData = new FormData(event.currentTarget);
        const rawPrincipal = formData.get("principalExternalId");
        const principal = typeof rawPrincipal === "string" ? rawPrincipal.trim() : "";
        if (principal.length === 0) return;
        const message = t.securitySessionsPage.revokeAllSessions.confirm.replace("{principal}", principal);
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-muted-foreground text-sm">{t.securitySessionsPage.revokeAllSessions.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securitySessionsPage.revokeAllSessions.success}
        </p>
      )}

      <Field
        id={`${formId}-principalExternalId`}
        name="principalExternalId"
        label={t.securitySessionsPage.revokeAllSessions.principalExternalId}
        error={fieldErrors["principalExternalId"]}
      />

      <div>
        <Button type="submit" variant="destructive" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securitySessionsPage.revokeAllSessions.submitting
            : t.securitySessionsPage.revokeAllSessions.submit}
        </Button>
      </div>
    </form>
  );
}

// ── Auth methods & authenticate ─────────────────────────────────────────────────────────────────

/** "Register auth method" (T5.12e) — a standalone form. `kind` renders as an 11-value `<select>`. */
export function RegisterAuthMethodForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(registerAuthMethodAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securitySessionsPage.registerAuthMethod.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securitySessionsPage.registerAuthMethod.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-kind`}>{t.securitySessionsPage.registerAuthMethod.kind}</Label>
          <select id={`${formId}-kind`} name="kind" defaultValue="" className={SELECT_CLASS}>
            <option value="" disabled>
              {t.securitySessionsPage.registerAuthMethod.kindUnspecified}
            </option>
            <option value="password">{t.securitySessionsPage.authMethodKinds.password}</option>
            <option value="passkey">{t.securitySessionsPage.authMethodKinds.passkey}</option>
            <option value="magic_link">{t.securitySessionsPage.authMethodKinds.magic_link}</option>
            <option value="otp">{t.securitySessionsPage.authMethodKinds.otp}</option>
            <option value="email_verification">
              {t.securitySessionsPage.authMethodKinds.email_verification}
            </option>
            <option value="phone_verification">
              {t.securitySessionsPage.authMethodKinds.phone_verification}
            </option>
            <option value="oauth">{t.securitySessionsPage.authMethodKinds.oauth}</option>
            <option value="oidc">{t.securitySessionsPage.authMethodKinds.oidc}</option>
            <option value="saml">{t.securitySessionsPage.authMethodKinds.saml}</option>
            <option value="ldap">{t.securitySessionsPage.authMethodKinds.ldap}</option>
            <option value="enterprise_sso">
              {t.securitySessionsPage.authMethodKinds.enterprise_sso}
            </option>
          </select>
          {fieldErrors["kind"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["kind"]}</p>
          )}
        </div>
        <Field
          id={`${formId}-displayName`}
          name="displayName"
          label={t.securitySessionsPage.registerAuthMethod.displayName}
          error={fieldErrors["displayName"]}
        />
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          <input type="checkbox" name="enabled" defaultChecked />
          {t.securitySessionsPage.registerAuthMethod.enabled}
        </label>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securitySessionsPage.registerAuthMethod.submitting
            : t.securitySessionsPage.registerAuthMethod.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Authenticate" (T5.12e) — a simulation/testing tool for this console per the task brief (real
 * authentication happens outside the admin app), so this renders as a "try it" preview panel, same
 * as `CheckThreatIndicatorPanel`/`CheckAiActionPanel`: never navigates away, renders the returned
 * decision inline.
 */
export function AuthenticatePanel({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(authenticateAction, AUTHENTICATE_INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securitySessionsPage.authenticate.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-method`}>{t.securitySessionsPage.authenticate.method}</Label>
          <select id={`${formId}-method`} name="method" defaultValue="" className={SELECT_CLASS}>
            <option value="" disabled>
              {t.securitySessionsPage.registerAuthMethod.kindUnspecified}
            </option>
            <option value="password">{t.securitySessionsPage.authMethodKinds.password}</option>
            <option value="passkey">{t.securitySessionsPage.authMethodKinds.passkey}</option>
            <option value="magic_link">{t.securitySessionsPage.authMethodKinds.magic_link}</option>
            <option value="otp">{t.securitySessionsPage.authMethodKinds.otp}</option>
            <option value="email_verification">
              {t.securitySessionsPage.authMethodKinds.email_verification}
            </option>
            <option value="phone_verification">
              {t.securitySessionsPage.authMethodKinds.phone_verification}
            </option>
            <option value="oauth">{t.securitySessionsPage.authMethodKinds.oauth}</option>
            <option value="oidc">{t.securitySessionsPage.authMethodKinds.oidc}</option>
            <option value="saml">{t.securitySessionsPage.authMethodKinds.saml}</option>
            <option value="ldap">{t.securitySessionsPage.authMethodKinds.ldap}</option>
            <option value="enterprise_sso">
              {t.securitySessionsPage.authMethodKinds.enterprise_sso}
            </option>
          </select>
        </div>
        <Field id={`${formId}-identifier`} name="identifier" label={t.securitySessionsPage.authenticate.identifier} />
        <Field id={`${formId}-credential`} name="credential" label={t.securitySessionsPage.authenticate.credential} />
        <Field
          id={`${formId}-deviceFingerprint`}
          name="deviceFingerprint"
          label={t.securitySessionsPage.authenticate.deviceFingerprint}
        />
        <Field id={`${formId}-ip`} name="ip" label={t.securitySessionsPage.authenticate.ip} />
        <Field
          id={`${formId}-sessionTtlSeconds`}
          name="sessionTtlSeconds"
          label={t.securitySessionsPage.authenticate.sessionTtlSeconds}
          type="number"
          min={1}
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input type="checkbox" name="sensitiveAction" />
          {t.securitySessionsPage.authenticate.sensitiveAction}
        </label>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input type="checkbox" name="rememberDevice" />
          {t.securitySessionsPage.authenticate.rememberDevice}
        </label>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input type="checkbox" name="mfaSatisfied" />
          {t.securitySessionsPage.authenticate.mfaSatisfied}
        </label>
      </div>

      <div>
        <Button type="submit" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.securitySessionsPage.authenticate.submitting : t.securitySessionsPage.authenticate.submit}
        </Button>
      </div>

      {state.status === "success" && (
        <div className="border-border flex flex-col gap-2 rounded-xl border p-4 text-sm">
          <Badge variant={state.outcome.authenticated ? "success" : "destructive"} className="w-fit">
            {state.outcome.authenticated
              ? t.securitySessionsPage.authenticate.resultAuthenticated
              : t.securitySessionsPage.authenticate.resultDenied}
          </Badge>
          <p className="text-muted-foreground">
            {t.securitySessionsPage.authenticate.principalExternalId}:{" "}
            {state.outcome.principalExternalId ?? t.securitySessionsPage.noPrincipal}
          </p>
          <p className="text-muted-foreground">
            {t.securitySessionsPage.authenticate.sessionId}:{" "}
            {state.outcome.sessionId ?? t.securitySessionsPage.authenticate.noSession}
          </p>
          <p className="text-muted-foreground">
            {t.securitySessionsPage.authenticate.mfaRequirement}: {state.outcome.mfaRequirement}
          </p>
          <p className="text-muted-foreground">
            {t.securitySessionsPage.authenticate.riskScore}: {state.outcome.riskScore} ({state.outcome.riskBand})
          </p>
          {state.outcome.reason !== undefined && (
            <p className="text-muted-foreground">
              {t.securitySessionsPage.authenticate.reason}: {state.outcome.reason}
            </p>
          )}
        </div>
      )}
    </form>
  );
}

// ── Devices ──────────────────────────────────────────────────────────────────────────────────────

/** "Register device" (T5.12e) — a standalone form (idempotent per fingerprint; starts untrusted). */
export function RegisterDeviceForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(registerDeviceAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securitySessionsPage.registerDevice.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securitySessionsPage.registerDevice.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-fingerprint`}
          name="fingerprint"
          label={t.securitySessionsPage.registerDevice.fingerprint}
          error={fieldErrors["fingerprint"]}
        />
        <Field
          id={`${formId}-principalExternalId`}
          name="principalExternalId"
          label={t.securitySessionsPage.registerDevice.principalExternalId}
        />
        <Field
          id={`${formId}-tenantRef`}
          name="tenantRef"
          label={t.securitySessionsPage.registerDevice.tenantRef}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securitySessionsPage.registerDevice.submitting
            : t.securitySessionsPage.registerDevice.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * Records a device security signal — a per-row control on the device explorer. `severity` renders
 * as a 3-value `<select>`.
 */
export function RecordDeviceSignalRowForm({ fingerprint, t }: { readonly fingerprint: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(recordDeviceSignalAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="fingerprint" value={fingerprint} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Label htmlFor={`${formId}-type`} className="sr-only">
          {t.securitySessionsPage.deviceActions.signal.type}
        </Label>
        <Input
          id={`${formId}-type`}
          name="type"
          placeholder={t.securitySessionsPage.deviceActions.signal.type}
          className="h-8 w-24 text-xs"
        />
        <select
          name="severity"
          defaultValue=""
          className="border-input bg-card text-foreground h-8 rounded-xl border px-2 text-xs"
        >
          <option value="" disabled>
            {t.securitySessionsPage.deviceActions.signal.severityUnspecified}
          </option>
          <option value="low">{t.securitySessionsPage.severities.low}</option>
          <option value="medium">{t.securitySessionsPage.severities.medium}</option>
          <option value="high">{t.securitySessionsPage.severities.high}</option>
        </select>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securitySessionsPage.deviceActions.signal.submitting
            : t.securitySessionsPage.deviceActions.signal.submit}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

/** Explicitly trusts a device (remember-device) — a per-row control on the device explorer. */
export function TrustDeviceRowForm({ fingerprint, t }: { readonly fingerprint: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(trustDeviceAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="fingerprint" value={fingerprint} />
      <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
        {isPending
          ? t.securitySessionsPage.deviceActions.trust.submitting
          : t.securitySessionsPage.deviceActions.trust.submit}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

/** Blocks a device — a per-row control on the device explorer. Confirmed before submit (constraint #10). */
export function BlockDeviceRowForm({ fingerprint, t }: { readonly fingerprint: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(blockDeviceAction, INITIAL_STATE);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.securitySessionsPage.deviceActions.block.confirm)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="fingerprint" value={fingerprint} />
      <Button type="submit" size="sm" variant="destructive" loading={isPending} disabled={isPending}>
        {isPending
          ? t.securitySessionsPage.deviceActions.block.submitting
          : t.securitySessionsPage.deviceActions.block.submit}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

// ── MFA ──────────────────────────────────────────────────────────────────────────────────────────

const MFA_METHOD_OPTIONS = ["totp", "webauthn", "sms_otp", "email_otp", "backup_code"] as const;

/**
 * "Enroll MFA" (T5.12e) — a standalone form (no MFA-enrollment explorer is wired on this page, see
 * `enrollMfa`'s doc comment in `lib/api/security.ts`). `method` renders as a 5-value `<select>`.
 */
export function EnrollMfaForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(enrollMfaAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securitySessionsPage.enrollMfa.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securitySessionsPage.enrollMfa.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-principalExternalId`}
          name="principalExternalId"
          label={t.securitySessionsPage.enrollMfa.principalExternalId}
          error={fieldErrors["principalExternalId"]}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-method`}>{t.securitySessionsPage.enrollMfa.method}</Label>
          <select id={`${formId}-method`} name="method" defaultValue="" className={SELECT_CLASS}>
            <option value="" disabled>
              {t.securitySessionsPage.enrollMfa.methodUnspecified}
            </option>
            {MFA_METHOD_OPTIONS.map((kind) => (
              <option key={kind} value={kind}>
                {t.securitySessionsPage.mfaMethodKinds[kind]}
              </option>
            ))}
          </select>
          {fieldErrors["method"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["method"]}</p>
          )}
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.securitySessionsPage.enrollMfa.submitting : t.securitySessionsPage.enrollMfa.submit}
        </Button>
      </div>
    </form>
  );
}

/** "Verify MFA enrollment" (T5.12e) — a standalone form. */
export function VerifyMfaEnrollmentForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(verifyMfaEnrollmentAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securitySessionsPage.verifyMfa.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securitySessionsPage.verifyMfa.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-enrollmentId`}
          name="enrollmentId"
          label={t.securitySessionsPage.verifyMfa.enrollmentId}
          error={fieldErrors["enrollmentId"]}
        />
        <Field
          id={`${formId}-code`}
          name="code"
          label={t.securitySessionsPage.verifyMfa.code}
          error={fieldErrors["code"]}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.securitySessionsPage.verifyMfa.submitting : t.securitySessionsPage.verifyMfa.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Generate backup codes" (T5.12e) — the codes are returned exactly once and can never be
 * retrieved again (`generateBackupCodes`'s doc comment in `lib/api/security.ts`). The success
 * state renders them prominently as selectable, monospaced text with a copy-to-clipboard
 * affordance — deliberately not the same quiet "success" line every other form in this module
 * uses, so this can never be mistaken for a silent success. Nothing here logs the codes or keeps
 * them beyond this render (they live only in this component's own state, cleared on navigation).
 */
export function GenerateBackupCodesPanel({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(
    generateBackupCodesAction,
    BACKUP_CODES_INITIAL_STATE,
  );
  const [copied, setCopied] = useState(false);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securitySessionsPage.generateBackupCodes.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-enrollmentId`}
          name="enrollmentId"
          label={t.securitySessionsPage.generateBackupCodes.enrollmentId}
          error={fieldErrors["enrollmentId"]}
        />
        <Field
          id={`${formId}-count`}
          name="count"
          label={t.securitySessionsPage.generateBackupCodes.count}
          error={fieldErrors["count"]}
          type="number"
          min={1}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securitySessionsPage.generateBackupCodes.submitting
            : t.securitySessionsPage.generateBackupCodes.submit}
        </Button>
      </div>

      {state.status === "success" && (
        <div className="border-warning/40 bg-warning-subtle flex flex-col gap-3 rounded-xl border p-4">
          <p className="text-warning-foreground text-sm font-medium">
            {t.securitySessionsPage.generateBackupCodes.warning}
          </p>
          <ul
            className="bg-card grid select-all grid-cols-2 gap-x-4 gap-y-1 rounded-lg border p-3 font-mono text-sm sm:grid-cols-3"
          >
            {state.codes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(state.codes.join("\n")).then(() => {
                  setCopied(true);
                });
              }}
            >
              {copied ? (
                <>
                  <CheckIcon aria-hidden="true" className="size-4" />
                  {t.securitySessionsPage.generateBackupCodes.copied}
                </>
              ) : (
                <>
                  <CopyIcon aria-hidden="true" className="size-4" />
                  {t.securitySessionsPage.generateBackupCodes.copy}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

/** "Revoke MFA enrollment" (T5.12e) — a standalone form. Confirmed before submit (constraint #10). */
export function RevokeMfaForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(revokeMfaAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.securitySessionsPage.revokeMfa.confirm)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-muted-foreground text-sm">{t.securitySessionsPage.revokeMfa.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securitySessionsPage.revokeMfa.success}
        </p>
      )}

      <Field
        id={`${formId}-enrollmentId`}
        name="enrollmentId"
        label={t.securitySessionsPage.revokeMfa.enrollmentId}
        error={fieldErrors["enrollmentId"]}
      />

      <div>
        <Button type="submit" variant="destructive" loading={isPending} disabled={isPending}>
          {isPending ? t.securitySessionsPage.revokeMfa.submitting : t.securitySessionsPage.revokeMfa.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Decide MFA" (T5.12e) — "read-only" per the route's own summary despite being a POST, a
 * simulation/preview panel per the task brief. `riskBand` renders as a 4-value `<select>`.
 */
export function DecideMfaPanel({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(decideMfaAction, DECIDE_MFA_INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securitySessionsPage.decideMfa.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-principalExternalId`}
          name="principalExternalId"
          label={t.securitySessionsPage.decideMfa.principalExternalId}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-riskBand`}>{t.securitySessionsPage.decideMfa.riskBand}</Label>
          <select id={`${formId}-riskBand`} name="riskBand" defaultValue="" className={SELECT_CLASS}>
            <option value="" disabled>
              {t.securitySessionsPage.decideMfa.riskBandUnspecified}
            </option>
            <option value="low">{t.securitySessionsPage.riskBands.low}</option>
            <option value="moderate">{t.securitySessionsPage.riskBands.moderate}</option>
            <option value="elevated">{t.securitySessionsPage.riskBands.elevated}</option>
            <option value="high">{t.securitySessionsPage.riskBands.high}</option>
          </select>
        </div>
        <Field
          id={`${formId}-deviceFingerprint`}
          name="deviceFingerprint"
          label={t.securitySessionsPage.decideMfa.deviceFingerprint}
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input type="checkbox" name="sensitiveAction" />
          {t.securitySessionsPage.decideMfa.sensitiveAction}
        </label>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input type="checkbox" name="rememberDevice" />
          {t.securitySessionsPage.decideMfa.rememberDevice}
        </label>
      </div>

      <div>
        <Button type="submit" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.securitySessionsPage.decideMfa.submitting : t.securitySessionsPage.decideMfa.submit}
        </Button>
      </div>

      {state.status === "success" && (
        <div className="border-border flex flex-col gap-2 rounded-xl border p-4 text-sm">
          <Badge variant="neutral" className="w-fit">
            {state.decision.requirement}
          </Badge>
          {state.decision.reasons.length > 0 && (
            <ul className="text-muted-foreground flex flex-col gap-1">
              {state.decision.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

/** "Register MFA method" (T5.12e) — a standalone form. `kind` renders as a 5-value `<select>`. */
export function RegisterMfaMethodForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(registerMfaMethodAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securitySessionsPage.registerMfaMethod.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securitySessionsPage.registerMfaMethod.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-kind`}>{t.securitySessionsPage.registerMfaMethod.kind}</Label>
          <select id={`${formId}-kind`} name="kind" defaultValue="" className={SELECT_CLASS}>
            <option value="" disabled>
              {t.securitySessionsPage.enrollMfa.methodUnspecified}
            </option>
            {MFA_METHOD_OPTIONS.map((kind) => (
              <option key={kind} value={kind}>
                {t.securitySessionsPage.mfaMethodKinds[kind]}
              </option>
            ))}
          </select>
          {fieldErrors["kind"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["kind"]}</p>
          )}
        </div>
        <Field
          id={`${formId}-displayName`}
          name="displayName"
          label={t.securitySessionsPage.registerMfaMethod.displayName}
          error={fieldErrors["displayName"]}
        />
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          <input type="checkbox" name="enabled" defaultChecked />
          {t.securitySessionsPage.registerMfaMethod.enabled}
        </label>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securitySessionsPage.registerMfaMethod.submitting
            : t.securitySessionsPage.registerMfaMethod.submit}
        </Button>
      </div>
    </form>
  );
}

// ── Risk ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * "Evaluate risk" (T5.12e) — a preview/explainer tool ("explainable factors") per the task brief,
 * not a mutation. Renders every returned `RiskFactorDto` inline.
 */
export function EvaluateRiskPanel({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(evaluateRiskAction, EVALUATE_RISK_INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securitySessionsPage.evaluateRisk.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id={`${formId}-principalExternalId`}
          name="principalExternalId"
          label={t.securitySessionsPage.evaluateRisk.principalExternalId}
        />
        <Field id={`${formId}-ip`} name="ip" label={t.securitySessionsPage.evaluateRisk.ip} />
        <Field
          id={`${formId}-deviceFingerprint`}
          name="deviceFingerprint"
          label={t.securitySessionsPage.evaluateRisk.deviceFingerprint}
        />
      </div>

      <div>
        <Button type="submit" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.securitySessionsPage.evaluateRisk.submitting : t.securitySessionsPage.evaluateRisk.submit}
        </Button>
      </div>

      {state.status === "success" && (
        <div className="border-border flex flex-col gap-2 rounded-xl border p-4 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="neutral">{state.evaluation.band}</Badge>
            <span className="text-muted-foreground">
              {t.securitySessionsPage.evaluateRisk.score}: {state.evaluation.score}
            </span>
          </div>
          {state.evaluation.factors.length > 0 && (
            <ul className="text-muted-foreground flex flex-col gap-1">
              {state.evaluation.factors.map((factor) => (
                <li key={factor.code}>
                  {factor.code} ({factor.contribution >= 0 ? "+" : ""}
                  {factor.contribution}) — {factor.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

function Field({
  id,
  name,
  label,
  error,
  type,
  min,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly error?: string;
  readonly type?: string;
  readonly min?: number;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        min={min}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
      />
      {error !== undefined && (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
