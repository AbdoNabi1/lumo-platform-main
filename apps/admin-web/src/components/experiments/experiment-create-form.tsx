"use client";

import { useActionState, useId, useState, type FormEvent } from "react";
import { AlertTriangleIcon, PlusIcon, XIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createExperimentAction } from "@/app/experiments/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const SELECT_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-sm transition-colors ease-out";

interface VariantRow {
  readonly rowKey: string;
}

let nextVariantRowKey = 0;
function newVariantRowKey(): string {
  nextVariantRowKey += 1;
  return `experiment-variant-row-${nextVariantRowKey}`;
}

/**
 * The experiment create form (`app/experiments/new/page.tsx`, T5.11b). `variants` is a repeated
 * `{key, allocationPercentage, isControl}` row array — same array-of-rows technique
 * `ComponentCreateForm`'s `properties` rows use (T5.9c), including `isControl`'s "true"/"false"
 * `<select>` rather than a checkbox: an unchecked checkbox omits itself from `FormData` entirely,
 * which would desynchronize the parallel `variantKey`/`variantAllocationPercentage`/
 * `variantIsControl` arrays `parseVariants` (`app/experiments/actions.ts`) reads by index.
 *
 * Per the task brief, variant allocations must sum to 100 — validated client-side on submit
 * (`handleSubmit` below) for a fast error, and re-validated server-side in the action as defense in
 * depth; the backend is authoritative if the client check is somehow wrong.
 */
export function ExperimentCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createExperimentAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};
  const [rows, setRows] = useState<readonly VariantRow[]>(() => [
    { rowKey: newVariantRowKey() },
    { rowKey: newVariantRowKey() },
  ]);
  const [allocationError, setAllocationError] = useState<string | undefined>(undefined);

  function addRow(): void {
    setRows((current) => [...current, { rowKey: newVariantRowKey() }]);
  }

  function removeRow(rowKey: string): void {
    setRows((current) =>
      current.length > 1 ? current.filter((row) => row.rowKey !== rowKey) : current,
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    const data = new FormData(event.currentTarget);
    const allocations = data
      .getAll("variantAllocationPercentage")
      .map((value) => Number.parseFloat(typeof value === "string" ? value : ""));
    const sum = allocations.reduce((total, value) => total + (Number.isNaN(value) ? 0 : value), 0);
    if (Math.abs(sum - 100) > 0.001) {
      setAllocationError(t.experimentCreateForm.allocationSumError);
      event.preventDefault();
      return;
    }
    setAllocationError(undefined);
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-6">
      {state.status === "error" && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
        >
          <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${formId}-name`}
          name="name"
          label={t.experimentCreateForm.name}
          error={fieldErrors["name"]}
        />
        <Field
          id={`${formId}-goalMetricRef`}
          name="goalMetricRef"
          label={t.experimentCreateForm.goalMetricRef}
          error={fieldErrors["goalMetricRef"]}
        />
        <Field
          id={`${formId}-audiencePercentage`}
          name="audiencePercentage"
          label={t.experimentCreateForm.audiencePercentage}
          error={fieldErrors["audiencePercentage"]}
          type="number"
          min={0}
          max={100}
        />
        <Field
          id={`${formId}-featureFlagRef`}
          name="featureFlagRef"
          label={t.experimentCreateForm.featureFlagRef}
          error={fieldErrors["featureFlagRef"]}
        />
        <Field
          id={`${formId}-audienceSegmentRefs`}
          name="audienceSegmentRefs"
          label={t.experimentCreateForm.audienceSegmentRefs}
          error={fieldErrors["audienceSegmentRefs"]}
          placeholder="segment-1, segment-2"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-hypothesis`}>{t.experimentCreateForm.hypothesis}</Label>
        <Input id={`${formId}-hypothesis`} name="hypothesis" />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">{t.experimentCreateForm.variants}</h3>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <PlusIcon aria-hidden="true" />
            {t.experimentCreateForm.addVariant}
          </Button>
        </div>
        {fieldErrors["variants"] !== undefined && (
          <p className="text-destructive text-sm">{fieldErrors["variants"]}</p>
        )}
        {allocationError !== undefined && (
          <p className="text-destructive text-sm">{allocationError}</p>
        )}
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div
              key={row.rowKey}
              className="grid grid-cols-1 gap-3 sm:grid-cols-[1.5fr_1fr_1fr_2.5rem]"
            >
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={`${formId}-variantKey-${index}`}
                  className={index > 0 ? "sr-only" : undefined}
                >
                  {t.experimentCreateForm.variantKey}
                </Label>
                <Input id={`${formId}-variantKey-${index}`} name="variantKey" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={`${formId}-variantAllocationPercentage-${index}`}
                  className={index > 0 ? "sr-only" : undefined}
                >
                  {t.experimentCreateForm.variantAllocationPercentage}
                </Label>
                <Input
                  id={`${formId}-variantAllocationPercentage-${index}`}
                  name="variantAllocationPercentage"
                  type="number"
                  min={0}
                  max={100}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={`${formId}-variantIsControl-${index}`}
                  className={index > 0 ? "sr-only" : undefined}
                >
                  {t.experimentCreateForm.variantIsControl}
                </Label>
                <select
                  id={`${formId}-variantIsControl-${index}`}
                  name="variantIsControl"
                  className={SELECT_CLASS}
                  defaultValue={index === 0 ? "true" : "false"}
                >
                  <option value="true">{t.experimentCreateForm.yes}</option>
                  <option value="false">{t.experimentCreateForm.no}</option>
                </select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={index === 0 ? "mt-6" : undefined}
                disabled={rows.length === 1}
                onClick={() => removeRow(row.rowKey)}
                aria-label={t.experimentCreateForm.removeVariant}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.experimentCreateForm.submitting : t.experimentCreateForm.submit}
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
  max,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly error?: string;
  readonly placeholder?: string;
  readonly type?: string;
  readonly min?: number;
  readonly max?: number;
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
        max={max}
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
