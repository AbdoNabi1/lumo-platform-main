"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import {
  governMachineIdentityAction,
  issueCredentialAction,
  registerPrincipalAction,
  revokeCredentialAction,
  rotateCredentialAction,
  suspendMachineIdentityAction,
  transitionPrincipalAction,
} from "@/app/security/identity/actions";
import {
  PRINCIPAL_STATUS_TRANSITIONS,
  type PrincipalTransitionTarget,
} from "@/lib/api/security-transitions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

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

/**
 * "Register principal" (T5.12b) — a standalone create form. `kind`'s 8 values render as a
 * `<select>` per the task brief (a fixed enum, not free text). `attributes` (the backend's
 * optional ABAC bag) is deliberately left off this form: the brief calls out `kind` specifically
 * and never asks for a free-form key/value editor, and the field is fully optional server-side.
 */
export function RegisterPrincipalForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(registerPrincipalAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityIdentityPage.register.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityIdentityPage.register.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-externalId`}
          name="externalId"
          label={t.securityIdentityPage.register.externalId}
          error={fieldErrors["externalId"]}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-kind`}>{t.securityIdentityPage.register.kind}</Label>
          <select id={`${formId}-kind`} name="kind" defaultValue="" className={SELECT_CLASS}>
            <option value="" disabled>
              {t.securityIdentityPage.register.kindUnspecified}
            </option>
            <option value="human">{t.securityIdentityPage.register.kinds.human}</option>
            <option value="service_account">
              {t.securityIdentityPage.register.kinds.service_account}
            </option>
            <option value="machine">{t.securityIdentityPage.register.kinds.machine}</option>
            <option value="api_key">{t.securityIdentityPage.register.kinds.api_key}</option>
            <option value="robot">{t.securityIdentityPage.register.kinds.robot}</option>
            <option value="partner">{t.securityIdentityPage.register.kinds.partner}</option>
            <option value="marketplace">{t.securityIdentityPage.register.kinds.marketplace}</option>
            <option value="ai">{t.securityIdentityPage.register.kinds.ai}</option>
          </select>
          {fieldErrors["kind"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["kind"]}</p>
          )}
        </div>
        <Field
          id={`${formId}-displayName`}
          name="displayName"
          label={t.securityIdentityPage.register.displayName}
          error={fieldErrors["displayName"]}
        />
        <Field
          id={`${formId}-subjectRef`}
          name="subjectRef"
          label={t.securityIdentityPage.register.subjectRef}
        />
        <Field
          id={`${formId}-tenantRef`}
          name="tenantRef"
          label={t.securityIdentityPage.register.tenantRef}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.securityIdentityPage.register.submitting : t.securityIdentityPage.register.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Transition" (T5.12b) — a per-row control on the identity-overview table. `IdentityOverviewDto`'s
 * rows expose the real `externalId` (unlike the machine-identity/AI-governance explorers, whose
 * `principalRef` is an internal id — see `lib/api/security.ts`), so this attaches directly to each
 * row instead of needing a standalone form. Only the options `PRINCIPAL_STATUS_TRANSITIONS` marks
 * legal from the row's current status are offered; a `disabled` principal has none, so the control
 * renders nothing. Suspend/disable are confirmed before submit — not literally the route table's
 * one labeled "kill-switch" (that's `suspendMachineIdentity`), but both are hard-to-reverse moves
 * on a real principal (constraint #10's spirit), while reactivating is not.
 */
export function TransitionPrincipalControl({
  externalId,
  status,
  t,
}: {
  readonly externalId: string;
  readonly status: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(transitionPrincipalAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  const options = (
    PRINCIPAL_STATUS_TRANSITIONS as Readonly<Record<string, readonly PrincipalTransitionTarget[]>>
  )[status];

  if (options === undefined || options.length === 0) {
    return <span className="text-muted-foreground text-xs">{t.securityIdentityPage.transition.noTransitions}</span>;
  }

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const formData = new FormData(event.currentTarget);
        const to = formData.get("to");
        const confirmMessage =
          to === "suspended"
            ? t.securityIdentityPage.transition.confirmSuspend
            : to === "disabled"
              ? t.securityIdentityPage.transition.confirmDisable
              : undefined;
        if (confirmMessage !== undefined && !window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="externalId" value={externalId} />
      <div className="flex items-center gap-2">
        <Label htmlFor={`${formId}-to`} className="sr-only">
          {t.securityIdentityPage.transition.to}
        </Label>
        <select id={`${formId}-to`} name="to" defaultValue={options[0]} className={SELECT_CLASS}>
          {options.map((target) => (
            <option key={target} value={target}>
              {t.securityIdentityPage.transition.targets[target]}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.securityIdentityPage.transition.submitting : t.securityIdentityPage.transition.submit}
        </Button>
      </div>
      {state.status === "error" && fieldErrors["externalId"] === undefined && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

/**
 * "Govern machine identity" (T5.12b) — the idempotent create-or-patch form. `externalId` plus the
 * 6 named `config` fields, rendered directly per the task brief (a fixed shape, not a
 * `Record<string,string>`). `maxCredentialTtlSeconds`/`rotationIntervalDays` each pair a number
 * input with a clear checkbox to reach the backend's explicit-`null` clear case, same pattern
 * `GovernAiIdentityForm` uses for `tokenBudget`/`callQuota`.
 */
export function GovernMachineIdentityForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(governMachineIdentityAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">{t.securityIdentityPage.governMachine.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityIdentityPage.governMachine.success}
        </p>
      )}

      <Field
        id={`${formId}-externalId`}
        name="externalId"
        label={t.securityIdentityPage.governMachine.externalId}
        error={fieldErrors["externalId"]}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${formId}-owner`} name="owner" label={t.securityIdentityPage.governMachine.owner} />
        <Field id={`${formId}-purpose`} name="purpose" label={t.securityIdentityPage.governMachine.purpose} />
        <Field
          id={`${formId}-allowedEnvironments`}
          name="allowedEnvironments"
          label={t.securityIdentityPage.governMachine.allowedEnvironments}
          placeholder="staging, production"
        />
        <Field
          id={`${formId}-allowedScopes`}
          name="allowedScopes"
          label={t.securityIdentityPage.governMachine.allowedScopes}
          placeholder="scope-1, scope-2"
        />
        <div className="flex flex-col gap-1.5">
          <Field
            id={`${formId}-maxCredentialTtlSeconds`}
            name="maxCredentialTtlSeconds"
            label={t.securityIdentityPage.governMachine.maxCredentialTtlSeconds}
            error={fieldErrors["maxCredentialTtlSeconds"]}
            type="number"
            min={1}
          />
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            <input type="checkbox" name="maxCredentialTtlSecondsUnlimited" />
            {t.securityIdentityPage.governMachine.maxCredentialTtlUnlimited}
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <Field
            id={`${formId}-rotationIntervalDays`}
            name="rotationIntervalDays"
            label={t.securityIdentityPage.governMachine.rotationIntervalDays}
            error={fieldErrors["rotationIntervalDays"]}
            type="number"
            min={1}
          />
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            <input type="checkbox" name="rotationIntervalDaysUnlimited" />
            {t.securityIdentityPage.governMachine.rotationIntervalUnlimited}
          </label>
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityIdentityPage.governMachine.submitting
            : t.securityIdentityPage.governMachine.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Suspend" (T5.12b) — the kill-switch. Standalone form with a manual `externalId` field (the
 * machine-identity explorer's rows don't expose one to attach a per-row button to, see
 * `suspendMachineIdentityAction`'s doc comment), guarded by `window.confirm` before submit — same
 * `SuspendAiIdentityForm` (T5.12a) precedent.
 */
export function SuspendMachineIdentityForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(suspendMachineIdentityAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.securityIdentityPage.suspendMachine.confirm)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-muted-foreground text-sm">{t.securityIdentityPage.suspendMachine.subtitle}</p>

      {state.status === "error" && fieldErrors["externalId"] === undefined && (
        <ErrorBanner message={state.message} />
      )}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityIdentityPage.suspendMachine.success}
        </p>
      )}

      <Field
        id={`${formId}-externalId`}
        name="externalId"
        label={t.securityIdentityPage.suspendMachine.externalId}
        error={fieldErrors["externalId"]}
      />

      <div>
        <Button type="submit" variant="destructive" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityIdentityPage.suspendMachine.submitting
            : t.securityIdentityPage.suspendMachine.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Issue credential" (T5.12c) — a standalone create form. `kind`'s 5 values render as a `<select>`
 * per the task brief, same treatment `RegisterPrincipalForm`'s `kind` already gets. `material` is a
 * handle to the secret value that's fingerprinted server-side and never persisted or returned (see
 * `issueCredentialAction`'s doc comment) — this form does not echo it back after a successful
 * submit. `expiresAt` is optional, a `datetime-local` input.
 */
export function IssueCredentialForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(issueCredentialAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityIdentityPage.issueCredential.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityIdentityPage.issueCredential.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-principalExternalId`}
          name="principalExternalId"
          label={t.securityIdentityPage.issueCredential.principalExternalId}
          error={fieldErrors["principalExternalId"]}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-kind`}>{t.securityIdentityPage.issueCredential.kind}</Label>
          <select id={`${formId}-kind`} name="kind" defaultValue="" className={SELECT_CLASS}>
            <option value="" disabled>
              {t.securityIdentityPage.issueCredential.kindUnspecified}
            </option>
            <option value="api_key">{t.securityIdentityPage.issueCredential.kinds.api_key}</option>
            <option value="secret">{t.securityIdentityPage.issueCredential.kinds.secret}</option>
            <option value="certificate">
              {t.securityIdentityPage.issueCredential.kinds.certificate}
            </option>
            <option value="signing_key">
              {t.securityIdentityPage.issueCredential.kinds.signing_key}
            </option>
            <option value="oauth_client">
              {t.securityIdentityPage.issueCredential.kinds.oauth_client}
            </option>
          </select>
          {fieldErrors["kind"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["kind"]}</p>
          )}
        </div>
        <Field
          id={`${formId}-material`}
          name="material"
          label={t.securityIdentityPage.issueCredential.material}
          error={fieldErrors["material"]}
        />
        <Field
          id={`${formId}-expiresAt`}
          name="expiresAt"
          label={t.securityIdentityPage.issueCredential.expiresAt}
          error={fieldErrors["expiresAt"]}
          type="datetime-local"
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityIdentityPage.issueCredential.submitting
            : t.securityIdentityPage.issueCredential.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Rotate credential" (T5.12c) — standalone form with a manual `credentialId` field (see
 * `rotateCredentialAction`'s doc comment: neither read model on this page lists credentials at all).
 * `newMaterial` only — the backend derives the rotated KMS key ref and fingerprint itself.
 */
export function RotateCredentialForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(rotateCredentialAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityIdentityPage.rotateCredential.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityIdentityPage.rotateCredential.success}
        </p>
      )}

      <Field
        id={`${formId}-credentialId`}
        name="credentialId"
        label={t.securityIdentityPage.rotateCredential.credentialId}
        error={fieldErrors["credentialId"]}
      />
      <Field
        id={`${formId}-newMaterial`}
        name="newMaterial"
        label={t.securityIdentityPage.rotateCredential.newMaterial}
        error={fieldErrors["newMaterial"]}
      />

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityIdentityPage.rotateCredential.submitting
            : t.securityIdentityPage.rotateCredential.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Revoke credential" (T5.12c) — immediate and, from this screen, irreversible (no "un-revoke"
 * route exists), so it's confirmed client-side before submit (constraint #10). Standalone with a
 * manual `credentialId` field, same reasoning as `RotateCredentialForm`.
 */
export function RevokeCredentialForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(revokeCredentialAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.securityIdentityPage.revokeCredential.confirm)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-muted-foreground text-sm">{t.securityIdentityPage.revokeCredential.subtitle}</p>

      {state.status === "error" && fieldErrors["credentialId"] === undefined && (
        <ErrorBanner message={state.message} />
      )}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityIdentityPage.revokeCredential.success}
        </p>
      )}

      <Field
        id={`${formId}-credentialId`}
        name="credentialId"
        label={t.securityIdentityPage.revokeCredential.credentialId}
        error={fieldErrors["credentialId"]}
      />

      <div>
        <Button type="submit" variant="destructive" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityIdentityPage.revokeCredential.submitting
            : t.securityIdentityPage.revokeCredential.submit}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  name,
  label,
  error,
  placeholder,
  type,
  min,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly error?: string;
  readonly placeholder?: string;
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
        placeholder={placeholder}
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
