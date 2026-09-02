"use client";

import { useActionState, useId } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@platform/ui";
import {
  advanceExperimentAction,
  declareExperimentWinnerAction,
  recordExperimentResultAction,
} from "@/app/experiments/actions";
import type { FormState } from "@/lib/api/mutation";
import { advanceableExperimentStatusesFrom } from "@/lib/experiment-lifecycle";
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

/** The generic "advance to…" control (`POST /experiments/:experimentId/transitions`) — the only status-changing route on this domain, and unlike Feature Flags this body carries no `changedBy`. */
function AdvanceForm({
  experimentId,
  statuses,
  t,
}: {
  readonly experimentId: string;
  readonly statuses: readonly string[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(advanceExperimentAction, INITIAL_STATE);
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="experimentId" value={experimentId} />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-toStatus`} className="text-muted-foreground text-xs">
            {t.experimentLifecycle.advanceToLabel}
          </Label>
          <select id={`${formId}-toStatus`} name="toStatus" className={SELECT_CLASS}>
            {statuses.map((target) => (
              <option key={target} value={target}>
                {(t.experimentStatus as Record<string, string>)[target] ?? target}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.experimentLifecycle.advancing : t.experimentLifecycle.advance}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/** `POST /experiments/:experimentId/results` — **not** idempotent, per the route table. `variantKey` is offered only among the experiment's own variants. */
function RecordResultForm({
  experimentId,
  variantKeys,
  t,
}: {
  readonly experimentId: string;
  readonly variantKeys: readonly string[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(
    recordExperimentResultAction,
    INITIAL_STATE,
  );
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="experimentId" value={experimentId} />
      <h3 className="text-sm font-semibold">{t.experimentLifecycle.recordResultTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-variantKey`} className="text-muted-foreground text-xs">
            {t.experimentLifecycle.variantKeyLabel}
          </Label>
          <select id={`${formId}-variantKey`} name="variantKey" className={SELECT_CLASS}>
            {variantKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-metricValue`} className="text-muted-foreground text-xs">
            {t.experimentLifecycle.metricValueLabel}
          </Label>
          <Input
            id={`${formId}-metricValue`}
            name="metricValue"
            type="number"
            step="any"
            className="h-8 w-28 text-xs"
            aria-invalid={fieldErrors["metricValue"] !== undefined || undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-sampleSize`} className="text-muted-foreground text-xs">
            {t.experimentLifecycle.sampleSizeLabel}
          </Label>
          <Input
            id={`${formId}-sampleSize`}
            name="sampleSize"
            type="number"
            min={0}
            className="h-8 w-28 text-xs"
            aria-invalid={fieldErrors["sampleSize"] !== undefined || undefined}
          />
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending
            ? t.experimentLifecycle.recordingResult
            : t.experimentLifecycle.recordResult}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/** `POST /experiments/:experimentId/winner` — `variantKey` is offered only among the experiment's own variants. */
function DeclareWinnerForm({
  experimentId,
  variantKeys,
  t,
}: {
  readonly experimentId: string;
  readonly variantKeys: readonly string[];
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(
    declareExperimentWinnerAction,
    INITIAL_STATE,
  );
  const formId = useId();

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="experimentId" value={experimentId} />
      <h3 className="text-sm font-semibold">{t.experimentLifecycle.declareWinnerTitle}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${formId}-variantKey`} className="text-muted-foreground text-xs">
            {t.experimentLifecycle.variantKeyLabel}
          </Label>
          <select id={`${formId}-variantKey`} name="variantKey" className={SELECT_CLASS}>
            {variantKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline" loading={isPending} disabled={isPending}>
          {isPending
            ? t.experimentLifecycle.declaringWinner
            : t.experimentLifecycle.declareWinner}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/**
 * The Experiment Detail screen's write controls (T5.11b): the generic "advance to…" transitions
 * control (gated by `lib/experiment-lifecycle.ts`, hidden entirely at the terminal `archived`
 * status), and the record-result/declare-winner forms, offered whenever the experiment has at
 * least one variant (both need a `variantKey` to pick from) — the backend is authoritative if a
 * given status rejects one of these actions.
 */
export function ExperimentLifecycleActions({
  experimentId,
  status,
  variantKeys,
  t,
}: {
  readonly experimentId: string;
  readonly status: string;
  readonly variantKeys: readonly string[];
  readonly t: Dictionary;
}) {
  const advanceTargets = advanceableExperimentStatusesFrom(status);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.experimentLifecycle.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {advanceTargets.length > 0 && (
          <AdvanceForm experimentId={experimentId} statuses={advanceTargets} t={t} />
        )}
        {variantKeys.length > 0 && (
          <>
            <RecordResultForm experimentId={experimentId} variantKeys={variantKeys} t={t} />
            <DeclareWinnerForm experimentId={experimentId} variantKeys={variantKeys} t={t} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
