"use client";

import { useActionState, useId } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import {
  addFeatureFlagRuleAction,
  advanceFeatureFlagAction,
  setFeatureFlagEnvironmentOverrideAction,
  setFeatureFlagRolloutAction,
} from "@/app/feature-flags/actions";
import type { FormState } from "@/lib/api/mutation";
import { advanceableFlagStatusesFrom } from "@/lib/feature-flag-lifecycle";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out";

function FormError({ state }: { readonly state: FormState }) {
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="text-destructive text-xs">
      {state.message}
    </p>
  );
}

/**
 * The shared `changedBy` field every write route on this domain (except create) carries — an
 * audit-trail actor id, distinct from auth/session identity. Pre-filled from the current admin
 * user's identity (`getCurrentUser()`) when available, per the task brief, but always editable —
 * the operator may be acting on someone else's behalf.
 */
function ChangedByField({
  formId,
  defaultValue,
  error,
  t,
}: {
  readonly formId: string;
  readonly defaultValue: string;
  readonly error?: string;
  readonly t: Dictionary;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${formId}-changedBy`} className="text-muted-foreground text-xs">
        {t.featureFlagLifecycle.changedByLabel}
      </Label>
      <Input
        id={`${formId}-changedBy`}
        name="changedBy"
        defaultValue={defaultValue}
        className="h-8 text-xs"
        aria-invalid={error !== undefined || undefined}
      />
    </div>
  );
}

/** The generic "advance to…" control (`POST /feature-flags/:flagId/transitions`) — the only status-changing route on this domain. */
function AdvanceForm({
  flagId,
  statuses,
  changedByDefault,
  t,
}: {
  readonly flagId: string;
  readonly statuses: readonly string[];
  readonly changedByDefault: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(advanceFeatureFlagAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="flagId" value={flagId} />
      <h3 className="text-sm font-semibold">{t.featureFlagLifecycle.advanceTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-toStatus`} className="text-muted-foreground text-xs">
            {t.featureFlagLifecycle.advanceToLabel}
          </Label>
          <select id={`${formId}-toStatus`} name="toStatus" className={SELECT_CLASS}>
            {statuses.map((target) => (
              <option key={target} value={target}>
                {(t.featureFlagStatus as Record<string, string>)[target] ?? target}
              </option>
            ))}
          </select>
        </div>
        <ChangedByField
          formId={formId}
          defaultValue={changedByDefault}
          error={fieldErrors["changedBy"]}
          t={t}
        />
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.featureFlagLifecycle.advancing : t.featureFlagLifecycle.advance}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/** `POST /feature-flags/:flagId/rollout` — the flag's global rollout percentage. */
function RolloutForm({
  flagId,
  currentPercentage,
  changedByDefault,
  t,
}: {
  readonly flagId: string;
  readonly currentPercentage: number;
  readonly changedByDefault: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(
    setFeatureFlagRolloutAction,
    INITIAL_STATE,
  );
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="flagId" value={flagId} />
      <h3 className="text-sm font-semibold">{t.featureFlagLifecycle.rolloutTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-percentage`} className="text-muted-foreground text-xs">
            {t.featureFlagLifecycle.percentageLabel}
          </Label>
          <Input
            id={`${formId}-percentage`}
            name="percentage"
            type="number"
            min={0}
            max={100}
            defaultValue={currentPercentage}
            className="h-8 w-24 text-xs"
            aria-invalid={fieldErrors["percentage"] !== undefined || undefined}
          />
        </div>
        <ChangedByField
          formId={formId}
          defaultValue={changedByDefault}
          error={fieldErrors["changedBy"]}
          t={t}
        />
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.featureFlagLifecycle.settingRollout : t.featureFlagLifecycle.setRollout}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

const RULE_TYPES = ["tenant", "user", "attribute"] as const;

/** `POST /feature-flags/:flagId/rules` — **not** idempotent, per the route table. */
function AddRuleForm({
  flagId,
  changedByDefault,
  t,
}: {
  readonly flagId: string;
  readonly changedByDefault: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(addFeatureFlagRuleAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="flagId" value={flagId} />
      <h3 className="text-sm font-semibold">{t.featureFlagLifecycle.addRuleTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-type`} className="text-muted-foreground text-xs">
            {t.featureFlagLifecycle.ruleTypeLabel}
          </Label>
          <select id={`${formId}-type`} name="type" className={SELECT_CLASS}>
            {RULE_TYPES.map((type) => (
              <option key={type} value={type}>
                {(t.featureFlagRuleType as Record<string, string>)[type] ?? type}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-attribute`} className="text-muted-foreground text-xs">
            {t.featureFlagLifecycle.ruleAttributeLabel}
          </Label>
          <Input
            id={`${formId}-attribute`}
            name="attribute"
            className="h-8 w-32 text-xs"
            aria-invalid={fieldErrors["attribute"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-values`} className="text-muted-foreground text-xs">
            {t.featureFlagLifecycle.ruleValuesLabel}
          </Label>
          <Input
            id={`${formId}-values`}
            name="values"
            placeholder="tenant-1, tenant-2"
            className="h-8 w-48 text-xs"
            aria-invalid={fieldErrors["values"] !== undefined || undefined}
          />
        </div>
        <div className="flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" id={`${formId}-enabled`} name="enabled" defaultChecked />
          <Label htmlFor={`${formId}-enabled`} className="text-xs">
            {t.featureFlagLifecycle.ruleEnabledLabel}
          </Label>
        </div>
        <ChangedByField
          formId={formId}
          defaultValue={changedByDefault}
          error={fieldErrors["changedBy"]}
          t={t}
        />
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.featureFlagLifecycle.addingRule : t.featureFlagLifecycle.addRule}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/** `POST /feature-flags/:flagId/environment-overrides` — set or update a per-environment override. */
function EnvironmentOverrideForm({
  flagId,
  changedByDefault,
  t,
}: {
  readonly flagId: string;
  readonly changedByDefault: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(
    setFeatureFlagEnvironmentOverrideAction,
    INITIAL_STATE,
  );
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="flagId" value={flagId} />
      <h3 className="text-sm font-semibold">{t.featureFlagLifecycle.environmentOverrideTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-environment`} className="text-muted-foreground text-xs">
            {t.featureFlagLifecycle.environmentLabel}
          </Label>
          <Input
            id={`${formId}-environment`}
            name="environment"
            placeholder="production"
            className="h-8 w-32 text-xs"
            aria-invalid={fieldErrors["environment"] !== undefined || undefined}
          />
        </div>
        <div className="flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" id={`${formId}-enabled`} name="enabled" defaultChecked />
          <Label htmlFor={`${formId}-enabled`} className="text-xs">
            {t.featureFlagLifecycle.environmentEnabledLabel}
          </Label>
        </div>
        <div className="flex flex-col gap-1">
          <Label
            htmlFor={`${formId}-rolloutPercentage`}
            className="text-muted-foreground text-xs"
          >
            {t.featureFlagLifecycle.environmentRolloutLabel}
          </Label>
          <Input
            id={`${formId}-rolloutPercentage`}
            name="rolloutPercentage"
            type="number"
            min={0}
            max={100}
            className="h-8 w-24 text-xs"
            aria-invalid={fieldErrors["rolloutPercentage"] !== undefined || undefined}
          />
        </div>
        <ChangedByField
          formId={formId}
          defaultValue={changedByDefault}
          error={fieldErrors["changedBy"]}
          t={t}
        />
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending
            ? t.featureFlagLifecycle.settingEnvironmentOverride
            : t.featureFlagLifecycle.setEnvironmentOverride}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/**
 * The Feature Flag Detail screen's write controls (T5.11b): the generic "advance to…" transitions
 * control (gated by `lib/feature-flag-lifecycle.ts`, hidden entirely at the terminal `archived`
 * status), and the rollout/add-rule/environment-override forms, offered unconditionally — the brief
 * does not gate these by status, and the backend is authoritative if a given status rejects one.
 * Every form here carries its own `changedBy` audit field, pre-filled from `changedByDefault`
 * (the current admin user's identity) but always editable.
 */
export function FeatureFlagLifecycleActions({
  flagId,
  status,
  rolloutPercentage,
  changedByDefault,
  t,
}: {
  readonly flagId: string;
  readonly status: string;
  readonly rolloutPercentage: number;
  readonly changedByDefault: string;
  readonly t: Dictionary;
}) {
  const advanceTargets = advanceableFlagStatusesFrom(status);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.featureFlagLifecycle.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {advanceTargets.length > 0 && (
          <AdvanceForm
            flagId={flagId}
            statuses={advanceTargets}
            changedByDefault={changedByDefault}
            t={t}
          />
        )}
        <RolloutForm
          flagId={flagId}
          currentPercentage={rolloutPercentage}
          changedByDefault={changedByDefault}
          t={t}
        />
        <AddRuleForm flagId={flagId} changedByDefault={changedByDefault} t={t} />
        <EnvironmentOverrideForm flagId={flagId} changedByDefault={changedByDefault} t={t} />
      </CardContent>
    </Card>
  );
}
