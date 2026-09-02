"use client";

import { useActionState, useId, useState } from "react";
import { AlertTriangleIcon, PlusIcon, XIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { createNotificationAction } from "@/app/notifications/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

const TEXTAREA_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) min-h-32 w-full rounded-xl border px-3.5 py-2.5 text-sm transition-colors ease-out";

interface VariableRow {
  readonly rowKey: string;
  readonly name: string;
  readonly value: string;
}

let nextVariableRowKey = 0;
function newVariableRowKey(): string {
  nextVariableRowKey += 1;
  return `notification-variable-row-${nextVariableRowKey}`;
}

/**
 * The notification create form (`app/notifications/new/page.tsx`, T5.11a) —
 * `createNotificationBody`'s `variables` is a `Record<string,string>`, rendered as a repeated
 * key/value row array, same technique `components/theme/theme-variables-editor.tsx`'s
 * `VariableRowGroup` uses for T5.9c. `idempotencyKey` is not a form field — the action mints it via
 * `newIdempotencyKey()` and passes the same value to both the request body and the
 * `Idempotency-Key` header (the brief's double-field note).
 */
export function NotificationCreateForm({ t }: { readonly t: Dictionary }) {
  const [state, formAction, isPending] = useActionState(createNotificationAction, INITIAL_STATE);
  const formId = useId();
  const fieldErrors = state.status === "error" ? state.fieldErrors : {};
  const [rows, setRows] = useState<readonly VariableRow[]>(() => [
    { rowKey: newVariableRowKey(), name: "", value: "" },
  ]);

  function addRow(): void {
    setRows((current) => [...current, { rowKey: newVariableRowKey(), name: "", value: "" }]);
  }

  function removeRow(rowKey: string): void {
    setRows((current) =>
      current.length > 1 ? current.filter((row) => row.rowKey !== rowKey) : current,
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
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
          id={`${formId}-sourceRef`}
          name="sourceRef"
          label={t.notificationCreateForm.sourceRef}
          error={fieldErrors["sourceRef"]}
        />
        <Field
          id={`${formId}-recipientRef`}
          name="recipientRef"
          label={t.notificationCreateForm.recipientRef}
          error={fieldErrors["recipientRef"]}
        />
        <Field
          id={`${formId}-channels`}
          name="channels"
          label={t.notificationCreateForm.channels}
          error={fieldErrors["channels"]}
          placeholder="email, sms"
        />
        <Field
          id={`${formId}-templateId`}
          name="templateId"
          label={t.notificationCreateForm.templateId}
          error={fieldErrors["templateId"]}
        />
        <Field
          id={`${formId}-maxAttempts`}
          name="maxAttempts"
          label={t.notificationCreateForm.maxAttempts}
          error={fieldErrors["maxAttempts"]}
          type="number"
          min={1}
          defaultValue="3"
        />
        <Field
          id={`${formId}-expiresAt`}
          name="expiresAt"
          label={t.notificationCreateForm.expiresAt}
          error={fieldErrors["expiresAt"]}
          type="datetime-local"
        />
      </div>

      <Field
        id={`${formId}-subjectPattern`}
        name="subjectPattern"
        label={t.notificationCreateForm.subjectPattern}
        error={fieldErrors["subjectPattern"]}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-bodyPattern`}>{t.notificationCreateForm.bodyPattern}</Label>
        <textarea
          id={`${formId}-bodyPattern`}
          name="bodyPattern"
          rows={5}
          aria-invalid={fieldErrors["bodyPattern"] !== undefined || undefined}
          className={TEXTAREA_CLASS}
        />
        {fieldErrors["bodyPattern"] !== undefined && (
          <p className="text-destructive text-sm">{fieldErrors["bodyPattern"]}</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">{t.notificationCreateForm.variables}</h3>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <PlusIcon aria-hidden="true" />
            {t.notificationCreateForm.addRow}
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div key={row.rowKey} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_2.5rem]">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={`${formId}-variablesKey-${index}`}
                  className={index > 0 ? "sr-only" : undefined}
                >
                  {t.notificationCreateForm.variableName}
                </Label>
                <Input
                  id={`${formId}-variablesKey-${index}`}
                  name="variablesKey"
                  defaultValue={row.name}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={`${formId}-variablesValue-${index}`}
                  className={index > 0 ? "sr-only" : undefined}
                >
                  {t.notificationCreateForm.variableValue}
                </Label>
                <Input
                  id={`${formId}-variablesValue-${index}`}
                  name="variablesValue"
                  defaultValue={row.value}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={index === 0 ? "mt-6" : undefined}
                disabled={rows.length === 1}
                onClick={() => removeRow(row.rowKey)}
                aria-label={t.notificationCreateForm.removeRow}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.notificationCreateForm.submitting : t.notificationCreateForm.submit}
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
  defaultValue,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly error?: string;
  readonly placeholder?: string;
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
