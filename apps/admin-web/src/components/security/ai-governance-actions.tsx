"use client";

import { useActionState, useId } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import {
  checkAiActionAction,
  governAiIdentityAction,
  suspendAiIdentityAction,
  type CheckAiActionFormState,
} from "@/app/security/ai-governance/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const GOVERN_INITIAL_STATE: FormState = { status: "idle" };
const SUSPEND_INITIAL_STATE: FormState = { status: "idle" };
const CHECK_INITIAL_STATE: CheckAiActionFormState = { status: "idle" };

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
 * "Govern AI identity" (T5.12a) — the idempotent create-or-patch form. `externalId` plus the 6
 * named `config` fields, rendered directly per the task brief (a fixed shape, not a
 * `Record<string,string>`). `tokenBudget`/`callQuota` each pair a number input with an "unlimited"
 * checkbox to reach the backend's explicit-`null` clear case (see `governAiIdentityAction`'s
 * `nullableIntField`) — a blank number input alone can only mean "leave unchanged".
 */
export function GovernAiIdentityForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(governAiIdentityAction, GOVERN_INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">{t.securityAiGovernancePage.govern.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAiGovernancePage.govern.success}
        </p>
      )}

      <Field
        id={`${formId}-externalId`}
        name="externalId"
        label={t.securityAiGovernancePage.govern.externalId}
        error={fieldErrors["externalId"]}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Field
            id={`${formId}-tokenBudget`}
            name="tokenBudget"
            label={t.securityAiGovernancePage.govern.tokenBudget}
            error={fieldErrors["tokenBudget"]}
            type="number"
            min={0}
          />
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            <input type="checkbox" name="tokenBudgetUnlimited" />
            {t.securityAiGovernancePage.govern.tokenBudgetUnlimited}
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <Field
            id={`${formId}-callQuota`}
            name="callQuota"
            label={t.securityAiGovernancePage.govern.callQuota}
            error={fieldErrors["callQuota"]}
            type="number"
            min={0}
          />
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            <input type="checkbox" name="callQuotaUnlimited" />
            {t.securityAiGovernancePage.govern.callQuotaUnlimited}
          </label>
        </div>
        <Field
          id={`${formId}-windowSeconds`}
          name="windowSeconds"
          label={t.securityAiGovernancePage.govern.windowSeconds}
          error={fieldErrors["windowSeconds"]}
          type="number"
          min={1}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${formId}-isolationLevel`}>
            {t.securityAiGovernancePage.govern.isolationLevel}
          </Label>
          <select
            id={`${formId}-isolationLevel`}
            name="isolationLevel"
            defaultValue=""
            className={SELECT_CLASS}
          >
            <option value="">{t.securityAiGovernancePage.govern.isolationLevelUnspecified}</option>
            <option value="none">{t.securityAiGovernancePage.isolationLevels.none}</option>
            <option value="sandboxed">{t.securityAiGovernancePage.isolationLevels.sandboxed}</option>
            <option value="isolated">{t.securityAiGovernancePage.isolationLevels.isolated}</option>
          </select>
          {fieldErrors["isolationLevel"] !== undefined && (
            <p className="text-destructive text-sm">{fieldErrors["isolationLevel"]}</p>
          )}
        </div>
        <Field
          id={`${formId}-allowedTools`}
          name="allowedTools"
          label={t.securityAiGovernancePage.govern.allowedTools}
          placeholder="tool-1, tool-2"
        />
        <Field
          id={`${formId}-allowedResources`}
          name="allowedResources"
          label={t.securityAiGovernancePage.govern.allowedResources}
          placeholder="urn:1, urn:2"
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.securityAiGovernancePage.govern.submitting : t.securityAiGovernancePage.govern.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Suspend" (T5.12a) — the kill-switch. Standalone form with a manual `externalId` field (the
 * explorer's rows don't expose one to attach a per-row button to, see `suspendAiIdentityAction`'s
 * doc comment), guarded by `window.confirm` before submit — same `ProductLifecycleActions` (T5.1)
 * precedent used for archive/delete.
 */
export function SuspendAiIdentityForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(suspendAiIdentityAction, SUSPEND_INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(t.securityAiGovernancePage.suspend.confirm)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-muted-foreground text-sm">{t.securityAiGovernancePage.suspend.subtitle}</p>

      {state.status === "error" && fieldErrors["externalId"] === undefined && (
        <ErrorBanner message={state.message} />
      )}
      {state.status === "success" && (
        <p role="status" className="text-success text-sm">
          {t.securityAiGovernancePage.suspend.success}
        </p>
      )}

      <Field
        id={`${formId}-externalId`}
        name="externalId"
        label={t.securityAiGovernancePage.suspend.externalId}
        error={fieldErrors["externalId"]}
      />

      <div>
        <Button type="submit" variant="destructive" loading={isPending} disabled={isPending}>
          {isPending ? t.securityAiGovernancePage.suspend.submitting : t.securityAiGovernancePage.suspend.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Check AI action" (T5.12a) — a simulation/preview panel, not a mutation with lasting effect
 * worth navigating away for (see `checkAiActionAction`'s doc comment, matching T5.8's
 * `PromotionEvaluatePanel`). Renders the raw `AiActionDecisionDto` back inline; never
 * `revalidatePath`s anything.
 */
export function CheckAiActionPanel({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(checkAiActionAction, CHECK_INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t.securityAiGovernancePage.check.subtitle}</p>

      {state.status === "error" && <ErrorBanner message={state.message} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-externalId`}
          name="externalId"
          label={t.securityAiGovernancePage.check.externalId}
        />
        <Field id={`${formId}-tool`} name="tool" label={t.securityAiGovernancePage.check.tool} />
        <Field id={`${formId}-resource`} name="resource" label={t.securityAiGovernancePage.check.resource} />
        <Field
          id={`${formId}-tokens`}
          name="tokens"
          label={t.securityAiGovernancePage.check.tokens}
          type="number"
          min={0}
        />
        <Field
          id={`${formId}-calls`}
          name="calls"
          label={t.securityAiGovernancePage.check.calls}
          type="number"
          min={0}
        />
      </div>

      <div>
        <Button type="submit" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.securityAiGovernancePage.check.submitting : t.securityAiGovernancePage.check.submit}
        </Button>
      </div>

      {state.status === "success" && (
        <div className="border-border flex flex-col gap-2 rounded-xl border p-4 text-sm">
          <p className="font-semibold">
            {state.decision.allowed
              ? t.securityAiGovernancePage.check.resultAllowed
              : t.securityAiGovernancePage.check.resultDenied}
          </p>
          {state.decision.reason !== undefined && (
            <p className="text-muted-foreground">
              {t.securityAiGovernancePage.check.reason}: {state.decision.reason}
            </p>
          )}
          <p className="text-muted-foreground">
            {t.securityAiGovernancePage.check.remainingTokens}:{" "}
            {state.decision.remainingTokens ?? t.securityAiGovernancePage.unlimited}
          </p>
          <p className="text-muted-foreground">
            {t.securityAiGovernancePage.check.remainingCalls}:{" "}
            {state.decision.remainingCalls ?? t.securityAiGovernancePage.unlimited}
          </p>
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
