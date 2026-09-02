"use client";

import { useActionState, useId, useState } from "react";
import { AlertTriangleIcon, PlusIcon, XIcon } from "lucide-react";
import { Button, Input, Label } from "@platform/ui";
import { updateThemeVariablesAction } from "@/app/theme/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

interface VariableRow {
  readonly rowKey: string;
  readonly name: string;
  readonly value: string;
}

let nextVariableRowKey = 0;
function newVariableRowKey(): string {
  nextVariableRowKey += 1;
  return `variable-row-${nextVariableRowKey}`;
}

function rowsFromRecord(record: Readonly<Record<string, string>>): readonly VariableRow[] {
  const entries = Object.entries(record);
  if (entries.length === 0) return [{ rowKey: newVariableRowKey(), name: "", value: "" }];
  return entries.map(([name, value]) => ({ rowKey: newVariableRowKey(), name, value }));
}

/**
 * The Theme Detail variables editor (T5.9c), rendered only when `status === "draft"` per
 * `POST /themes/:themeId/variables`'s own summary ("Update a draft theme's variables"). `colors`/
 * `typography`/`spacing` are each `Record<string,string>` — rendered as three independent
 * repeated key/value row arrays (same array-of-rows technique `OrderLineItemsField`/
 * `ProductCreateForm`'s variant rows use), pre-populated from the theme's current values and
 * submitting the full replacement set (`updateThemeVariablesAction` parses each group's parallel
 * `*Key`/`*Value` fields back into a `Record<string,string>`).
 */
export function ThemeVariablesEditor({
  themeId,
  colors,
  typography,
  spacing,
  t,
}: {
  readonly themeId: string;
  readonly colors: Readonly<Record<string, string>>;
  readonly typography: Readonly<Record<string, string>>;
  readonly spacing: Readonly<Record<string, string>>;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(
    updateThemeVariablesAction,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="themeId" value={themeId} />

      {state.status === "error" && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm"
        >
          <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      <VariableRowGroup
        title={t.themeVariables.colors}
        addLabel={t.themeVariables.addRow}
        removeLabel={t.themeVariables.removeRow}
        nameLabel={t.themeVariables.name}
        valueLabel={t.themeVariables.value}
        nameFieldName="colorsKey"
        valueFieldName="colorsValue"
        initial={colors}
      />
      <VariableRowGroup
        title={t.themeVariables.typography}
        addLabel={t.themeVariables.addRow}
        removeLabel={t.themeVariables.removeRow}
        nameLabel={t.themeVariables.name}
        valueLabel={t.themeVariables.value}
        nameFieldName="typographyKey"
        valueFieldName="typographyValue"
        initial={typography}
      />
      <VariableRowGroup
        title={t.themeVariables.spacing}
        addLabel={t.themeVariables.addRow}
        removeLabel={t.themeVariables.removeRow}
        nameLabel={t.themeVariables.name}
        valueLabel={t.themeVariables.value}
        nameFieldName="spacingKey"
        valueFieldName="spacingValue"
        initial={spacing}
      />

      <div>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? t.themeVariables.saving : t.themeVariables.save}
        </Button>
      </div>
    </form>
  );
}

function VariableRowGroup({
  title,
  addLabel,
  removeLabel,
  nameLabel,
  valueLabel,
  nameFieldName,
  valueFieldName,
  initial,
}: {
  readonly title: string;
  readonly addLabel: string;
  readonly removeLabel: string;
  readonly nameLabel: string;
  readonly valueLabel: string;
  readonly nameFieldName: string;
  readonly valueFieldName: string;
  readonly initial: Readonly<Record<string, string>>;
}) {
  const [rows, setRows] = useState<readonly VariableRow[]>(() => rowsFromRecord(initial));
  const formId = useId();

  function addRow(): void {
    setRows((current) => [...current, { rowKey: newVariableRowKey(), name: "", value: "" }]);
  }

  function removeRow(rowKey: string): void {
    setRows((current) =>
      current.length > 1 ? current.filter((row) => row.rowKey !== rowKey) : current,
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{title}</h3>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <PlusIcon aria-hidden="true" />
          {addLabel}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <div key={row.rowKey} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_2.5rem]">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor={`${formId}-${nameFieldName}-${index}`}
                className={index > 0 ? "sr-only" : undefined}
              >
                {nameLabel}
              </Label>
              <Input
                id={`${formId}-${nameFieldName}-${index}`}
                name={nameFieldName}
                defaultValue={row.name}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor={`${formId}-${valueFieldName}-${index}`}
                className={index > 0 ? "sr-only" : undefined}
              >
                {valueLabel}
              </Label>
              <Input
                id={`${formId}-${valueFieldName}-${index}`}
                name={valueFieldName}
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
              aria-label={removeLabel}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
