"use client";

import { useId } from "react";
import { Trash2Icon } from "lucide-react";
import { Button, Input, Label, NativeSelect } from "@platform/ui";
import { CustomerTagsEditor } from "@/components/customers/customer-tags-editor";
import type { SegmentField } from "@/lib/api/customer-segments";
import {
  OPS_BY_FIELD,
  SEGMENT_FIELDS,
  valueKind,
  withField,
  withOp,
  type ConditionDraft,
} from "@/lib/customers/segment-draft";
import type { Dictionary } from "@/messages/en";

/**
 * One editable condition: filter → operator → value. The value input is the one the filter
 * needs — a whole number, money in the shop currency (major units), days, a date, a yes/no,
 * tag chips, country codes or a language. Errors (the editor's own or the server's, already
 * resolved to text) sit under the row and are tied to the inputs with `aria-describedby`.
 */
export function SegmentConditionRow({
  t,
  currency,
  index,
  draft,
  errors,
  disabled,
  canRemove,
  onChange,
  onRemove,
}: {
  readonly t: Dictionary;
  readonly currency: string;
  /** Zero-based position; shown as `index + 1`. */
  readonly index: number;
  readonly draft: ConditionDraft;
  readonly errors: readonly string[];
  readonly disabled: boolean;
  readonly canRemove: boolean;
  readonly onChange: (next: ConditionDraft) => void;
  readonly onRemove: () => void;
}) {
  const k = t.segments.editor;
  const baseId = useId();
  const number = String(index + 1);
  const kind = valueKind(draft.field, draft.op);
  const ops = OPS_BY_FIELD[draft.field];
  const errorId = `${baseId}-error`;
  const invalid = errors.length > 0;
  const describedBy = [
    invalid ? errorId : undefined,
    kind === "countries" ? `${baseId}-hint` : undefined,
  ]
    .filter((id): id is string => id !== undefined)
    .join(" ");
  const valueId = `${baseId}-value`;

  return (
    <div
      role="group"
      aria-label={k.conditionLabel.replace("{number}", number)}
      className="border-border flex flex-col gap-2 rounded-xl border p-3"
    >
      <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${baseId}-field`} className="sr-only">
            {k.fieldLabel}
          </Label>
          <NativeSelect
            id={`${baseId}-field`}
            value={draft.field}
            disabled={disabled}
            onChange={(event) => onChange(withField(draft, event.target.value as SegmentField))}
          >
            {SEGMENT_FIELDS.map((field) => (
              <option key={field} value={field}>
                {k.fields[field]}
              </option>
            ))}
          </NativeSelect>
        </div>

        {ops.length > 0 ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${baseId}-op`} className="sr-only">
              {k.operatorLabel}
            </Label>
            <NativeSelect
              id={`${baseId}-op`}
              value={draft.op}
              disabled={disabled}
              onChange={(event) => onChange(withOp(draft, event.target.value))}
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {k.ops[op as keyof typeof k.ops]}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : (
          <div aria-hidden="true" className="hidden sm:block" />
        )}

        <div className="flex min-w-0 flex-col gap-1">
          {kind !== "none" && (
            <Label htmlFor={valueId} className="sr-only">
              {k.valueLabel}
            </Label>
          )}
          {(kind === "integer" || kind === "money" || kind === "days") && (
            <div className="flex items-center gap-2">
              <Input
                id={valueId}
                dir="ltr"
                inputMode={kind === "money" ? "decimal" : "numeric"}
                value={draft.text}
                disabled={disabled}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy === "" ? undefined : describedBy}
                onChange={(event) => onChange({ ...draft, text: event.target.value })}
              />
              {kind === "money" && (
                <span
                  className="text-muted-foreground text-sm"
                  title={k.moneyHint.replace("{currency}", currency)}
                >
                  {currency}
                </span>
              )}
              {kind === "days" && (
                <span className="text-muted-foreground text-sm">{k.daysUnit}</span>
              )}
            </div>
          )}
          {kind === "date" && (
            <Input
              id={valueId}
              type="date"
              dir="ltr"
              value={draft.text}
              disabled={disabled}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy === "" ? undefined : describedBy}
              onChange={(event) => onChange({ ...draft, text: event.target.value })}
            />
          )}
          {kind === "flag" && (
            <NativeSelect
              id={valueId}
              value={draft.flag ? "yes" : "no"}
              disabled={disabled}
              onChange={(event) => onChange({ ...draft, flag: event.target.value === "yes" })}
            >
              <option value="yes">{k.subscribed}</option>
              <option value="no">{k.notSubscribed}</option>
            </NativeSelect>
          )}
          {kind === "language" && (
            <NativeSelect
              id={valueId}
              value={draft.language}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...draft, language: event.target.value === "ar" ? "ar" : "en" })
              }
            >
              <option value="en">{t.customerForm.languageEnglish}</option>
              <option value="ar">{t.customerForm.languageArabic}</option>
            </NativeSelect>
          )}
          {kind === "tags" && (
            <CustomerTagsEditor
              tags={draft.values}
              inputId={valueId}
              invalid={invalid}
              describedBy={describedBy === "" ? undefined : describedBy}
              disabled={disabled}
              onChange={(values) => onChange({ ...draft, values })}
              t={t}
            />
          )}
          {kind === "countries" && (
            <>
              <Input
                id={valueId}
                dir="ltr"
                value={draft.text}
                placeholder={k.countriesPlaceholder}
                disabled={disabled}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy === "" ? undefined : describedBy}
                onChange={(event) => onChange({ ...draft, text: event.target.value })}
              />
              <p id={`${baseId}-hint`} className="text-muted-foreground text-xs">
                {k.countriesHint}
              </p>
            </>
          )}
        </div>

        {!disabled && canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={k.removeCondition.replace("{number}", number)}
            onClick={onRemove}
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        )}
      </div>
      {invalid && (
        <div id={errorId} role="alert" className="text-destructive flex flex-col gap-0.5 text-sm">
          {errors.map((message, position) => (
            <p key={`${position}:${message}`}>{message}</p>
          ))}
        </div>
      )}
    </div>
  );
}
