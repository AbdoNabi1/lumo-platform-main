"use client";

import { useActionState, useId, useState, type FormEvent } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Badge, Button, Input, Label } from "@platform/ui";
import {
  archivePolicyAction,
  assignRoleAction,
  checkAccessAction,
  configureTenantSecurityAction,
  defineRoleAction,
  definePolicyAction,
  deleteRelationTupleAction,
  evaluateAccessAction,
  grantDelegationAction,
  grantRolePermissionAction,
  publishPolicyVersionAction,
  registerPermissionAction,
  registerPolicyFragmentAction,
  revokeDelegationAction,
  revokeRoleAssignmentAction,
  simulatePolicyAction,
  startImpersonationAction,
  writeRelationTupleAction,
  type CheckAccessFormState,
  type EvaluateAccessFormState,
  type SimulatePolicyFormState,
  type StartImpersonationFormState,
} from "@/app/security/access/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };
const SIMULATE_POLICY_INITIAL_STATE: SimulatePolicyFormState = { status: "idle" };
const CHECK_ACCESS_INITIAL_STATE: CheckAccessFormState = { status: "idle" };
const EVALUATE_ACCESS_INITIAL_STATE: EvaluateAccessFormState = { status: "idle" };
const START_IMPERSONATION_INITIAL_STATE: StartImpersonationFormState = { status: "idle" };

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out";

const TEXTAREA_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) min-h-28 w-full rounded-xl border px-3.5 py-2.5 font-mono text-sm transition-colors ease-out aria-invalid:border-destructive aria-invalid:outline-destructive";

const LINES_TEXTAREA_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) min-h-20 w-full rounded-xl border px-3.5 py-2.5 text-sm transition-colors ease-out";

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

function Field({
  id,
  name,
  label,
  error,
  type,
  min,
  defaultValue,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly error?: string;
  readonly type?: string;
  readonly min?: number;
  readonly defaultValue?: string;
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
        defaultValue={defaultValue}
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

/** The 4-field `{organization,tenant,workspace,environment}` scope group every scoped form below shares. */
function ScopeFields({ formId, t }: { readonly formId: string; readonly t: Dictionary }) {
  return (
    <fieldset className="border-border grid gap-4 rounded-xl border p-3 sm:grid-cols-2">
      <legend className="text-muted-foreground px-1 text-xs">{t.securityAccessPage.scope.legend}</legend>
      <Field
        id={`${formId}-scopeOrganization`}
        name="scopeOrganization"
        label={t.securityAccessPage.scope.organization}
      />
      <Field id={`${formId}-scopeTenant`} name="scopeTenant" label={t.securityAccessPage.scope.tenant} />
      <Field
        id={`${formId}-scopeWorkspace`}
        name="scopeWorkspace"
        label={t.securityAccessPage.scope.workspace}
      />
      <Field
        id={`${formId}-scopeEnvironment`}
        name="scopeEnvironment"
        label={t.securityAccessPage.scope.environment}
      />
    </fieldset>
  );
}

/** Validates a JSON textarea on submit — same client-side technique T5.9c's `ComponentCreateForm` uses for `defaults`. */
function validateJson(
  event: FormEvent<HTMLFormElement>,
  fieldName: string,
  required: boolean,
  invalidMessage: string,
  setError: (message: string | undefined) => void,
): void {
  const raw = new FormData(event.currentTarget).get(fieldName);
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text.length === 0) {
    if (required) {
      setError(invalidMessage);
      event.preventDefault();
      return;
    }
    setError(undefined);
    return;
  }
  try {
    JSON.parse(text);
    setError(undefined);
  } catch {
    setError(invalidMessage);
    event.preventDefault();
  }
}

// ── Roles ────────────────────────────────────────────────────────────────────────────────────────

/** "Define role" (T5.12f) — a standalone create form. */
export function DefineRoleForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(defineRoleAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAccessPage.defineRole.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAccessPage.defineRole.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${formId}-key`} name="key" label={t.securityAccessPage.defineRole.key} error={fieldErrors["key"]} />
        <Field
          id={`${formId}-name`}
          name="name"
          label={t.securityAccessPage.defineRole.name}
          error={fieldErrors["name"]}
        />
        <Field
          id={`${formId}-parentKey`}
          name="parentKey"
          label={t.securityAccessPage.defineRole.parentKey}
        />
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input type="checkbox" name="isTemplate" />
          {t.securityAccessPage.defineRole.isTemplate}
        </label>
      </div>

      <ScopeFields formId={formId} t={t} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-permissions`}>{t.securityAccessPage.defineRole.permissions}</Label>
        <textarea
          id={`${formId}-permissions`}
          name="permissions"
          rows={3}
          className={LINES_TEXTAREA_CLASS}
          placeholder={t.securityAccessPage.defineRole.permissionsPlaceholder}
        />
        <p className="text-muted-foreground text-xs">{t.securityAccessPage.defineRole.permissionsHint}</p>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.securityAccessPage.defineRole.submitting : t.securityAccessPage.defineRole.submit}
        </Button>
      </div>
    </form>
  );
}

/** Grants a permission to a role — a per-row control on the permission explorer's Roles table. */
export function GrantRolePermissionRowForm({ roleKey, t }: { readonly roleKey: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(grantRolePermissionAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="roleKey" value={roleKey} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Label htmlFor={`${formId}-permission`} className="sr-only">
          {t.securityAccessPage.grantRolePermission.permission}
        </Label>
        <Input
          id={`${formId}-permission`}
          name="permission"
          placeholder={t.securityAccessPage.grantRolePermission.permission}
          className="h-8 w-40 text-xs"
        />
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAccessPage.grantRolePermission.submitting
            : t.securityAccessPage.grantRolePermission.submit}
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

/** "Assign role" (T5.12f) — a standalone form. `grantedBy` is pre-filled from the current admin user. */
export function AssignRoleForm({
  t,
  grantedByDefault,
}: {
  readonly t: Dictionary;
  readonly grantedByDefault: string;
}) {
  const [state, formAction, isPending] = useActionState(assignRoleAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAccessPage.assignRole.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAccessPage.assignRole.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-principalExternalId`}
          name="principalExternalId"
          label={t.securityAccessPage.assignRole.principalExternalId}
          error={fieldErrors["principalExternalId"]}
        />
        <Field
          id={`${formId}-roleKey`}
          name="roleKey"
          label={t.securityAccessPage.assignRole.roleKey}
          error={fieldErrors["roleKey"]}
        />
        <Field
          id={`${formId}-grantedBy`}
          name="grantedBy"
          label={t.securityAccessPage.assignRole.grantedBy}
          error={fieldErrors["grantedBy"]}
          defaultValue={grantedByDefault}
        />
        <Field
          id={`${formId}-ttlSeconds`}
          name="ttlSeconds"
          label={t.securityAccessPage.assignRole.ttlSeconds}
          error={fieldErrors["ttlSeconds"]}
          type="number"
          min={1}
        />
        <Field id={`${formId}-reason`} name="reason" label={t.securityAccessPage.assignRole.reason} />
      </div>

      <ScopeFields formId={formId} t={t} />

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.securityAccessPage.assignRole.submitting : t.securityAccessPage.assignRole.submit}
        </Button>
      </div>
    </form>
  );
}

/** "Revoke role assignment" (T5.12f) — a standalone form. Confirmed before submit (constraint #10). */
export function RevokeRoleAssignmentForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(revokeRoleAssignmentAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.securityAccessPage.revokeRoleAssignment.confirm)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-muted-foreground text-sm">{t.securityAccessPage.revokeRoleAssignment.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAccessPage.revokeRoleAssignment.success}
        </p>
      )}

      <Field
        id={`${formId}-assignmentId`}
        name="assignmentId"
        label={t.securityAccessPage.revokeRoleAssignment.assignmentId}
        error={fieldErrors["assignmentId"]}
      />

      <div>
        <Button type="submit" variant="destructive" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAccessPage.revokeRoleAssignment.submitting
            : t.securityAccessPage.revokeRoleAssignment.submit}
        </Button>
      </div>
    </form>
  );
}

// ── Policies ─────────────────────────────────────────────────────────────────────────────────────

/** "Define policy" (T5.12f) — a standalone form. `mode` renders as a 4-value `<select>`. */
export function DefinePolicyForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(definePolicyAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAccessPage.definePolicy.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAccessPage.definePolicy.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-key`}
          name="key"
          label={t.securityAccessPage.definePolicy.key}
          error={fieldErrors["key"]}
        />
        <Field
          id={`${formId}-name`}
          name="name"
          label={t.securityAccessPage.definePolicy.name}
          error={fieldErrors["name"]}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-mode`}>{t.securityAccessPage.definePolicy.mode}</Label>
          <select id={`${formId}-mode`} name="mode" defaultValue="" className={SELECT_CLASS}>
            <option value="" disabled>
              {t.securityAccessPage.definePolicy.modeUnspecified}
            </option>
            <option value="strict">{t.securityAccessPage.policyModes.strict}</option>
            <option value="balanced">{t.securityAccessPage.policyModes.balanced}</option>
            <option value="relaxed">{t.securityAccessPage.policyModes.relaxed}</option>
            <option value="custom">{t.securityAccessPage.policyModes.custom}</option>
          </select>
          {fieldErrors["mode"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["mode"]}</p>
          )}
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.securityAccessPage.definePolicy.submitting : t.securityAccessPage.definePolicy.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * Publishes a new immutable policy version and activates it — a per-row control on the Policies
 * table. `rules` is a raw JSON textarea (never a structured per-rule editor, per the task brief).
 * Confirmed with an explicit dialog naming the exact policy key — a live-traffic change (constraint
 * #10, task brief's own call-out).
 */
export function PublishPolicyVersionRowForm({ policyKey, t }: { readonly policyKey: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(publishPolicyVersionAction, INITIAL_STATE);
  const [rulesError, setRulesError] = useState<string | undefined>(undefined);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        validateJson(event, "rules", true, t.securityAccessPage.publishPolicyVersion.rulesInvalid, setRulesError);
        if (event.defaultPrevented) return;
        const message = t.securityAccessPage.publishPolicyVersion.confirm.replace("{policy}", policyKey);
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="policyKey" value={policyKey} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-rules`} className="text-xs">
          {t.securityAccessPage.publishPolicyVersion.rules}
        </Label>
        <textarea
          id={`${formId}-rules`}
          name="rules"
          rows={3}
          className={TEXTAREA_CLASS}
          placeholder={t.securityAccessPage.publishPolicyVersion.rulesPlaceholder}
          aria-invalid={
            rulesError !== undefined || fieldErrors["rules"] !== undefined || undefined
          }
        />
        <p className="text-muted-foreground text-xs">{t.securityAccessPage.publishPolicyVersion.rulesHint}</p>
        {rulesError !== undefined && <p className="text-destructive text-xs">{rulesError}</p>}
        {fieldErrors["rules"] !== undefined && (
          <p className="text-destructive text-xs">{fieldErrors["rules"]}</p>
        )}
      </div>
      <select
        name="defaultEffect"
        defaultValue=""
        className="border-input bg-card text-foreground h-8 w-fit rounded-xl border px-2 text-xs"
      >
        <option value="">{t.securityAccessPage.publishPolicyVersion.defaultEffectUnspecified}</option>
        <option value="allow">{t.securityAccessPage.policyEffects.allow}</option>
        <option value="challenge">{t.securityAccessPage.policyEffects.challenge}</option>
        <option value="block">{t.securityAccessPage.policyEffects.block}</option>
        <option value="review">{t.securityAccessPage.policyEffects.review}</option>
      </select>
      <div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAccessPage.publishPolicyVersion.submitting
            : t.securityAccessPage.publishPolicyVersion.submit}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="text-success text-xs">
          {t.securityAccessPage.publishPolicyVersion.success}
        </p>
      )}
    </form>
  );
}

/** Archives a policy — a per-row control on the Policies table. Confirmed before submit (constraint #10). */
export function ArchivePolicyRowForm({ policyKey, t }: { readonly policyKey: string; readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(archivePolicyAction, INITIAL_STATE);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.securityAccessPage.archivePolicy.confirm)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="policyKey" value={policyKey} />
      <Button type="submit" size="sm" variant="destructive" loading={isPending} disabled={isPending}>
        {isPending ? t.securityAccessPage.archivePolicy.submitting : t.securityAccessPage.archivePolicy.submit}
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
 * "Simulate policy" (T5.12f) — "(read-only)" per the route's own summary despite being a POST, a
 * pure what-if preview panel per the task brief. Standalone with a manually-typed `policyKey`.
 */
export function SimulatePolicyPanel({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(simulatePolicyAction, SIMULATE_POLICY_INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAccessPage.simulatePolicy.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id={`${formId}-policyKey`}
          name="policyKey"
          label={t.securityAccessPage.simulatePolicy.policyKey}
        />
        <Field
          id={`${formId}-risk`}
          name="risk"
          label={t.securityAccessPage.simulatePolicy.risk}
          type="number"
        />
        <Field
          id={`${formId}-trust`}
          name="trust"
          label={t.securityAccessPage.simulatePolicy.trust}
          type="number"
        />
        <Field
          id={`${formId}-environment`}
          name="environment"
          label={t.securityAccessPage.simulatePolicy.environment}
        />
        <Field
          id={`${formId}-resource`}
          name="resource"
          label={t.securityAccessPage.simulatePolicy.resource}
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input type="checkbox" name="principalActive" defaultChecked />
          {t.securityAccessPage.simulatePolicy.principalActive}
        </label>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input type="checkbox" name="sessionValid" defaultChecked />
          {t.securityAccessPage.simulatePolicy.sessionValid}
        </label>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input type="checkbox" name="permissionGranted" defaultChecked />
          {t.securityAccessPage.simulatePolicy.permissionGranted}
        </label>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input type="checkbox" name="deviceTrusted" />
          {t.securityAccessPage.simulatePolicy.deviceTrusted}
        </label>
      </div>

      <div>
        <Button type="submit" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.securityAccessPage.simulatePolicy.submitting : t.securityAccessPage.simulatePolicy.submit}
        </Button>
      </div>

      {state.status === "success" && (
        <div className="border-border flex flex-col gap-2 rounded-xl border p-4 text-sm">
          <Badge variant="neutral" className="w-fit">
            {state.decision.effect}
          </Badge>
          <p className="text-muted-foreground">
            {t.securityAccessPage.simulatePolicy.resultVersion}:{" "}
            {state.decision.policyVersion ?? t.securityAccessPage.noActiveVersion}
          </p>
          {state.decision.matchedRuleIds.length > 0 && (
            <p className="text-muted-foreground">
              {t.securityAccessPage.simulatePolicy.resultMatchedRules}: {state.decision.matchedRuleIds.join(", ")}
            </p>
          )}
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

// ── ReBAC relations ──────────────────────────────────────────────────────────────────────────────

function RelationTupleFields({
  formId,
  t,
  fieldErrors,
}: {
  readonly formId: string;
  readonly t: Dictionary;
  readonly fieldErrors: Readonly<Record<string, string>>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        id={`${formId}-namespace`}
        name="namespace"
        label={t.securityAccessPage.relationFields.namespace}
        error={fieldErrors["namespace"]}
      />
      <Field
        id={`${formId}-object`}
        name="object"
        label={t.securityAccessPage.relationFields.object}
        error={fieldErrors["object"]}
      />
      <Field
        id={`${formId}-relation`}
        name="relation"
        label={t.securityAccessPage.relationFields.relation}
        error={fieldErrors["relation"]}
      />
      <Field
        id={`${formId}-subject`}
        name="subject"
        label={t.securityAccessPage.relationFields.subject}
        error={fieldErrors["subject"]}
      />
    </div>
  );
}

/** "Write relation tuple" (T5.12f) — a standalone form (idempotent by key). */
export function WriteRelationTupleForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(writeRelationTupleAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAccessPage.writeRelationTuple.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAccessPage.writeRelationTuple.success}
        </p>
      )}

      <RelationTupleFields formId={formId} t={t} fieldErrors={fieldErrors} />

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAccessPage.writeRelationTuple.submitting
            : t.securityAccessPage.writeRelationTuple.submit}
        </Button>
      </div>
    </form>
  );
}

/** "Delete relation tuple" (T5.12f) — a standalone form. Confirmed before submit (constraint #10). */
export function DeleteRelationTupleForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(deleteRelationTupleAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.securityAccessPage.deleteRelationTuple.confirm)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-muted-foreground text-sm">{t.securityAccessPage.deleteRelationTuple.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAccessPage.deleteRelationTuple.success}
        </p>
      )}

      <RelationTupleFields formId={formId} t={t} fieldErrors={fieldErrors} />

      <div>
        <Button type="submit" variant="destructive" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAccessPage.deleteRelationTuple.submitting
            : t.securityAccessPage.deleteRelationTuple.submit}
        </Button>
      </div>
    </form>
  );
}

// ── Access checks (preview panels) ──────────────────────────────────────────────────────────────

/**
 * "Check access" (T5.12f) — the unified RBAC + ReBAC + ABAC check, a preview/explainer panel per
 * the task brief. `abac` is the backend's `z.unknown()` field — a raw JSON textarea.
 */
export function CheckAccessPanel({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(checkAccessAction, CHECK_ACCESS_INITIAL_STATE);
  const [abacError, setAbacError] = useState<string | undefined>(undefined);
  const formId = useId();

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        validateJson(event, "abac", false, t.securityAccessPage.checkAccess.abacInvalid, setAbacError);
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-muted-foreground text-sm">{t.securityAccessPage.checkAccess.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-principalExternalId`}
          name="principalExternalId"
          label={t.securityAccessPage.checkAccess.principalExternalId}
        />
        <Field id={`${formId}-permission`} name="permission" label={t.securityAccessPage.checkAccess.permission} />
        <Field id={`${formId}-namespace`} name="namespace" label={t.securityAccessPage.checkAccess.namespace} />
        <Field id={`${formId}-object`} name="object" label={t.securityAccessPage.checkAccess.object} />
        <Field id={`${formId}-relation`} name="relation" label={t.securityAccessPage.checkAccess.relation} />
      </div>

      <ScopeFields formId={formId} t={t} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-abac`}>{t.securityAccessPage.checkAccess.abac}</Label>
        <textarea
          id={`${formId}-abac`}
          name="abac"
          rows={3}
          className={TEXTAREA_CLASS}
          placeholder={t.securityAccessPage.checkAccess.abacPlaceholder}
          aria-invalid={abacError !== undefined || undefined}
        />
        <p className="text-muted-foreground text-xs">{t.securityAccessPage.checkAccess.abacHint}</p>
        {abacError !== undefined && <p className="text-destructive text-sm">{abacError}</p>}
      </div>

      <div>
        <Button type="submit" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.securityAccessPage.checkAccess.submitting : t.securityAccessPage.checkAccess.submit}
        </Button>
      </div>

      {state.status === "success" && (
        <div className="border-border flex flex-col gap-2 rounded-xl border p-4 text-sm">
          <Badge variant={state.decision.allowed ? "success" : "destructive"} className="w-fit">
            {state.decision.allowed
              ? t.securityAccessPage.checkAccess.resultAllowed
              : t.securityAccessPage.checkAccess.resultDenied}
          </Badge>
          <p className="text-muted-foreground">
            {t.securityAccessPage.checkAccess.grantedBy}:{" "}
            {state.decision.grantedBy.length > 0 ? state.decision.grantedBy.join(", ") : t.securityAccessPage.checkAccess.none}
          </p>
          <p className="text-muted-foreground">
            {t.securityAccessPage.checkAccess.abacSatisfied}: {String(state.decision.abacSatisfied)}
          </p>
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

/**
 * "Evaluate access" (T5.12f) — the zero-trust access evaluation, "the platform's single
 * authorization entry point". A preview/explainer panel per the task brief.
 */
export function EvaluateAccessPanel({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(evaluateAccessAction, EVALUATE_ACCESS_INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAccessPage.evaluateAccess.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id={`${formId}-principalExternalId`}
          name="principalExternalId"
          label={t.securityAccessPage.evaluateAccess.principalExternalId}
        />
        <Field id={`${formId}-permission`} name="permission" label={t.securityAccessPage.evaluateAccess.permission} />
        <Field id={`${formId}-sessionId`} name="sessionId" label={t.securityAccessPage.evaluateAccess.sessionId} />
        <Field id={`${formId}-resource`} name="resource" label={t.securityAccessPage.evaluateAccess.resource} />
        <Field
          id={`${formId}-environment`}
          name="environment"
          label={t.securityAccessPage.evaluateAccess.environment}
        />
        <Field id={`${formId}-deviceRef`} name="deviceRef" label={t.securityAccessPage.evaluateAccess.deviceRef} />
        <Field id={`${formId}-policyKey`} name="policyKey" label={t.securityAccessPage.evaluateAccess.policyKey} />
      </div>

      <ScopeFields formId={formId} t={t} />

      <fieldset className="border-border grid gap-4 rounded-xl border p-3 sm:grid-cols-3">
        <legend className="text-muted-foreground px-1 text-xs">{t.securityAccessPage.evaluateAccess.riskLegend}</legend>
        <Field
          id={`${formId}-failedAuthCount`}
          name="failedAuthCount"
          label={t.securityAccessPage.evaluateAccess.failedAuthCount}
          type="number"
        />
        <Field
          id={`${formId}-ipReputation`}
          name="ipReputation"
          label={t.securityAccessPage.evaluateAccess.ipReputation}
          type="number"
        />
        <div className="flex flex-col justify-end gap-2">
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            <input type="checkbox" name="newDevice" />
            {t.securityAccessPage.evaluateAccess.newDevice}
          </label>
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            <input type="checkbox" name="impossibleTravel" />
            {t.securityAccessPage.evaluateAccess.impossibleTravel}
          </label>
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            <input type="checkbox" name="threatIntelHit" />
            {t.securityAccessPage.evaluateAccess.threatIntelHit}
          </label>
        </div>
      </fieldset>

      <fieldset className="border-border grid gap-4 rounded-xl border p-3 sm:grid-cols-3">
        <legend className="text-muted-foreground px-1 text-xs">{t.securityAccessPage.evaluateAccess.trustLegend}</legend>
        <Field
          id={`${formId}-sessionAgeDays`}
          name="sessionAgeDays"
          label={t.securityAccessPage.evaluateAccess.sessionAgeDays}
          type="number"
        />
        <div className="flex flex-col justify-end gap-2">
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            <input type="checkbox" name="deviceTrusted" />
            {t.securityAccessPage.evaluateAccess.deviceTrusted}
          </label>
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            <input type="checkbox" name="mfaSatisfied" />
            {t.securityAccessPage.evaluateAccess.mfaSatisfied}
          </label>
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            <input type="checkbox" name="knownGoodPrincipal" />
            {t.securityAccessPage.evaluateAccess.knownGoodPrincipal}
          </label>
        </div>
      </fieldset>

      <div>
        <Button type="submit" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.securityAccessPage.evaluateAccess.submitting : t.securityAccessPage.evaluateAccess.submit}
        </Button>
      </div>

      {state.status === "success" && (
        <div className="border-border flex flex-col gap-2 rounded-xl border p-4 text-sm">
          <Badge variant={state.decision.allowed ? "success" : "destructive"} className="w-fit">
            {state.decision.effect}
          </Badge>
          <p className="text-muted-foreground">
            {t.securityAccessPage.evaluateAccess.riskTrust}: {state.decision.risk} / {state.decision.trust}
          </p>
          <p className="text-muted-foreground">
            {t.securityAccessPage.evaluateAccess.policy}:{" "}
            {state.decision.policyKey ?? t.securityAccessPage.evaluateAccess.noPolicy}
            {state.decision.policyVersion !== null ? ` v${state.decision.policyVersion}` : ""}
          </p>
          {state.decision.roleKeys.length > 0 && (
            <p className="text-muted-foreground">
              {t.securityAccessPage.evaluateAccess.roleKeys}: {state.decision.roleKeys.join(", ")}
            </p>
          )}
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

// ── Registries ───────────────────────────────────────────────────────────────────────────────────

/**
 * "Register policy fragment" (T5.12f) — a standalone form. `expression` is a raw JSON textarea (the
 * backend's own `z.unknown()` field).
 */
export function RegisterPolicyFragmentForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(registerPolicyFragmentAction, INITIAL_STATE);
  const [expressionError, setExpressionError] = useState<string | undefined>(undefined);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        validateJson(
          event,
          "expression",
          true,
          t.securityAccessPage.registerPolicyFragment.expressionInvalid,
          setExpressionError,
        );
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-muted-foreground text-sm">{t.securityAccessPage.registerPolicyFragment.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAccessPage.registerPolicyFragment.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-key`}
          name="key"
          label={t.securityAccessPage.registerPolicyFragment.key}
          error={fieldErrors["key"]}
        />
        <Field
          id={`${formId}-description`}
          name="description"
          label={t.securityAccessPage.registerPolicyFragment.description}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-expression`}>{t.securityAccessPage.registerPolicyFragment.expression}</Label>
        <textarea
          id={`${formId}-expression`}
          name="expression"
          rows={3}
          className={TEXTAREA_CLASS}
          placeholder={t.securityAccessPage.registerPolicyFragment.expressionPlaceholder}
          aria-invalid={
            expressionError !== undefined || fieldErrors["expression"] !== undefined || undefined
          }
        />
        <p className="text-muted-foreground text-xs">{t.securityAccessPage.registerPolicyFragment.expressionHint}</p>
        {expressionError !== undefined && (
          <p className="text-destructive text-sm">{expressionError}</p>
        )}
        {fieldErrors["expression"] !== undefined && (
          <p className="text-destructive text-sm">{fieldErrors["expression"]}</p>
        )}
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAccessPage.registerPolicyFragment.submitting
            : t.securityAccessPage.registerPolicyFragment.submit}
        </Button>
      </div>
    </form>
  );
}

/** "Register permission" (T5.12f) — a standalone form. */
export function RegisterPermissionForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(registerPermissionAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAccessPage.registerPermission.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAccessPage.registerPermission.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-permission`}
          name="permission"
          label={t.securityAccessPage.registerPermission.permission}
          error={fieldErrors["permission"]}
        />
        <Field
          id={`${formId}-description`}
          name="description"
          label={t.securityAccessPage.registerPermission.description}
          error={fieldErrors["description"]}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAccessPage.registerPermission.submitting
            : t.securityAccessPage.registerPermission.submit}
        </Button>
      </div>
    </form>
  );
}

// ── Delegations & impersonation ──────────────────────────────────────────────────────────────────

/** "Grant delegation" (T5.12f) — a standalone form. "One principal may act as another, time-boxed." */
export function GrantDelegationForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(grantDelegationAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAccessPage.grantDelegation.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAccessPage.grantDelegation.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-delegatorExternalId`}
          name="delegatorExternalId"
          label={t.securityAccessPage.grantDelegation.delegatorExternalId}
          error={fieldErrors["delegatorExternalId"]}
        />
        <Field
          id={`${formId}-delegateExternalId`}
          name="delegateExternalId"
          label={t.securityAccessPage.grantDelegation.delegateExternalId}
          error={fieldErrors["delegateExternalId"]}
        />
        <Field
          id={`${formId}-ttlSeconds`}
          name="ttlSeconds"
          label={t.securityAccessPage.grantDelegation.ttlSeconds}
          error={fieldErrors["ttlSeconds"]}
          type="number"
          min={1}
        />
        <Field id={`${formId}-reason`} name="reason" label={t.securityAccessPage.grantDelegation.reason} />
      </div>

      <ScopeFields formId={formId} t={t} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-permissions`}>{t.securityAccessPage.grantDelegation.permissions}</Label>
        <textarea
          id={`${formId}-permissions`}
          name="permissions"
          rows={2}
          className={LINES_TEXTAREA_CLASS}
          placeholder={t.securityAccessPage.defineRole.permissionsPlaceholder}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.securityAccessPage.grantDelegation.submitting : t.securityAccessPage.grantDelegation.submit}
        </Button>
      </div>
    </form>
  );
}

/** "Revoke delegation" (T5.12f) — a standalone form. Confirmed before submit (constraint #10). */
export function RevokeDelegationForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(revokeDelegationAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.securityAccessPage.revokeDelegation.confirm)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-muted-foreground text-sm">{t.securityAccessPage.revokeDelegation.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAccessPage.revokeDelegation.success}
        </p>
      )}

      <Field
        id={`${formId}-delegationId`}
        name="delegationId"
        label={t.securityAccessPage.revokeDelegation.delegationId}
        error={fieldErrors["delegationId"]}
      />

      <div>
        <Button type="submit" variant="destructive" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAccessPage.revokeDelegation.submitting
            : t.securityAccessPage.revokeDelegation.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Start impersonation" (T5.12f) — **the single highest-risk individual action in this entire
 * phase** per the task brief. `delegatorExternalId`/`delegateExternalId` are admin-typed, display-
 * only context (never sent to the API — only `delegationId` is) used to render an unmistakable
 * confirmation naming both principals, and the submit button stays disabled until the admin
 * re-types the exact `delegationId` into a separate confirmation field — the "type to confirm"
 * friction step the task brief calls out, on top of the `window.confirm` dialog every other
 * destructive control in this module uses.
 */
export function StartImpersonationForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(
    startImpersonationAction,
    START_IMPERSONATION_INITIAL_STATE,
  );
  const [delegationId, setDelegationId] = useState("");
  const [confirmDelegationId, setConfirmDelegationId] = useState("");
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};
  const confirmMatches = delegationId.length > 0 && confirmDelegationId === delegationId;

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!confirmMatches) {
          event.preventDefault();
          return;
        }
        const formData = new FormData(event.currentTarget);
        const delegatorRaw = formData.get("delegatorExternalId");
        const delegateRaw = formData.get("delegateExternalId");
        const delegator = (typeof delegatorRaw === "string" ? delegatorRaw : "").trim();
        const delegate = (typeof delegateRaw === "string" ? delegateRaw : "").trim();
        const message = t.securityAccessPage.startImpersonation.confirm
          .replace("{delegator}", delegator.length > 0 ? delegator : t.securityAccessPage.startImpersonation.unspecified)
          .replace("{delegate}", delegate.length > 0 ? delegate : t.securityAccessPage.startImpersonation.unspecified);
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-4"
    >
      <div
        role="alert"
        className="border-destructive/40 bg-destructive-subtle text-destructive-subtle-foreground flex items-start gap-2 rounded-xl border px-4 py-3 text-sm"
      >
        <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{t.securityAccessPage.startImpersonation.warning}</span>
      </div>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <div className="border-success/40 bg-success-subtle flex flex-col gap-1 rounded-xl border p-4 text-sm">
          <p className="text-success-foreground font-medium">{t.securityAccessPage.startImpersonation.success}</p>
          <p className="text-muted-foreground">
            {t.securityAccessPage.startImpersonation.sessionId}: {state.impersonation.sessionId}
          </p>
          <p className="text-muted-foreground">
            {t.securityAccessPage.startImpersonation.actingAs}: {state.impersonation.actingAs}
          </p>
          <p className="text-muted-foreground">
            {t.securityAccessPage.startImpersonation.impersonatedBy}: {state.impersonation.impersonatedBy}
          </p>
          <p className="text-muted-foreground">
            {t.securityAccessPage.startImpersonation.expiresAt}: {state.impersonation.expiresAt}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-delegationId`}>{t.securityAccessPage.startImpersonation.delegationId}</Label>
          <Input
            id={`${formId}-delegationId`}
            name="delegationId"
            value={delegationId}
            onChange={(event) => setDelegationId(event.target.value)}
            aria-invalid={fieldErrors["delegationId"] !== undefined || undefined}
          />
          {fieldErrors["delegationId"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["delegationId"]}</p>
          )}
        </div>
        <Field
          id={`${formId}-delegatorExternalId`}
          name="delegatorExternalId"
          label={t.securityAccessPage.startImpersonation.delegatorExternalId}
        />
        <Field
          id={`${formId}-delegateExternalId`}
          name="delegateExternalId"
          label={t.securityAccessPage.startImpersonation.delegateExternalId}
        />
        <Field
          id={`${formId}-refreshFingerprint`}
          name="refreshFingerprint"
          label={t.securityAccessPage.startImpersonation.refreshFingerprint}
          error={fieldErrors["refreshFingerprint"]}
        />
        <Field
          id={`${formId}-ttlSeconds`}
          name="ttlSeconds"
          label={t.securityAccessPage.startImpersonation.ttlSeconds}
          error={fieldErrors["ttlSeconds"]}
          type="number"
          min={1}
        />
      </div>

      <div className="border-destructive/30 flex flex-col gap-1.5 rounded-xl border p-3">
        <Label htmlFor={`${formId}-confirmDelegationId`}>
          {t.securityAccessPage.startImpersonation.confirmDelegationIdLabel}
        </Label>
        <Input
          id={`${formId}-confirmDelegationId`}
          name="confirmDelegationId"
          value={confirmDelegationId}
          onChange={(event) => setConfirmDelegationId(event.target.value)}
          aria-invalid={fieldErrors["confirmDelegationId"] !== undefined || undefined}
        />
        <p className="text-muted-foreground text-xs">
          {t.securityAccessPage.startImpersonation.confirmDelegationIdHint}
        </p>
        {fieldErrors["confirmDelegationId"] !== undefined && (
          <p className="text-destructive text-sm">{fieldErrors["confirmDelegationId"]}</p>
        )}
      </div>

      <div>
        <Button
          type="submit"
          variant="destructive"
          loading={isPending}
          disabled={isPending || !confirmMatches}
        >
          {isPending
            ? t.securityAccessPage.startImpersonation.submitting
            : t.securityAccessPage.startImpersonation.submit}
        </Button>
      </div>
    </form>
  );
}

// ── Tenant security ──────────────────────────────────────────────────────────────────────────────

/** "Configure tenant security" (T5.12f) — a standalone form (idempotent create-or-patch). */
export function ConfigureTenantSecurityForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(configureTenantSecurityAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAccessPage.configureTenantSecurity.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAccessPage.configureTenantSecurity.success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-tenantRef`}
          name="tenantRef"
          label={t.securityAccessPage.configureTenantSecurity.tenantRef}
          error={fieldErrors["tenantRef"]}
        />
        <Field
          id={`${formId}-residencyRegion`}
          name="residencyRegion"
          label={t.securityAccessPage.configureTenantSecurity.residencyRegion}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-isolationTier`}>
            {t.securityAccessPage.configureTenantSecurity.isolationTier}
          </Label>
          <select id={`${formId}-isolationTier`} name="isolationTier" defaultValue="" className={SELECT_CLASS}>
            <option value="">{t.securityAccessPage.configureTenantSecurity.unspecified}</option>
            <option value="pooled">{t.securityAccessPage.isolationTiers.pooled}</option>
            <option value="dedicated_schema">{t.securityAccessPage.isolationTiers.dedicated_schema}</option>
            <option value="dedicated_db">{t.securityAccessPage.isolationTiers.dedicated_db}</option>
          </select>
          {fieldErrors["isolationTier"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["isolationTier"]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-securityMode`}>
            {t.securityAccessPage.configureTenantSecurity.securityMode}
          </Label>
          <select id={`${formId}-securityMode`} name="securityMode" defaultValue="" className={SELECT_CLASS}>
            <option value="">{t.securityAccessPage.configureTenantSecurity.unspecified}</option>
            <option value="strict">{t.securityAccessPage.policyModes.strict}</option>
            <option value="balanced">{t.securityAccessPage.policyModes.balanced}</option>
            <option value="relaxed">{t.securityAccessPage.policyModes.relaxed}</option>
            <option value="custom">{t.securityAccessPage.policyModes.custom}</option>
          </select>
          {fieldErrors["securityMode"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["securityMode"]}</p>
          )}
        </div>
        <Field
          id={`${formId}-defaultPolicyKey`}
          name="defaultPolicyKey"
          label={t.securityAccessPage.configureTenantSecurity.defaultPolicyKey}
        />
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input type="checkbox" name="mfaRequired" />
          {t.securityAccessPage.configureTenantSecurity.mfaRequired}
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-allowedAuthMethods`}>
          {t.securityAccessPage.configureTenantSecurity.allowedAuthMethods}
        </Label>
        <textarea
          id={`${formId}-allowedAuthMethods`}
          name="allowedAuthMethods"
          rows={2}
          className={LINES_TEXTAREA_CLASS}
          placeholder={t.securityAccessPage.configureTenantSecurity.allowedAuthMethodsPlaceholder}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending
            ? t.securityAccessPage.configureTenantSecurity.submitting
            : t.securityAccessPage.configureTenantSecurity.submit}
        </Button>
      </div>
    </form>
  );
}
