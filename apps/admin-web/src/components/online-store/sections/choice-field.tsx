"use client";

import { Label, NativeSelect } from "@platform/ui";
import { errorAria, FieldError } from "./field-shared";

export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
}

/** Up to this many options read as segmented buttons; more are a select. */
export const SEGMENTED_MAX = 3;

/**
 * One choice from a few. Up to three options are a segmented radio group (real radio inputs, so
 * the arrow keys and the group name work natively); more are a select.
 */
export function ChoiceField({
  id,
  label,
  options,
  value,
  disabled,
  error,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly options: readonly ChoiceOption[];
  readonly value: string;
  readonly disabled: boolean;
  readonly error?: string | undefined;
  readonly onChange: (value: string) => void;
}) {
  const aria = errorAria(id, error);
  if (options.length > SEGMENTED_MAX) {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>
          <bdi>{label}</bdi>
        </Label>
        <NativeSelect
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.currentTarget.value)}
          {...aria}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
        <FieldError id={id} error={error} />
      </div>
    );
  }
  const labelId = `${id}-label`;
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-foreground text-base font-medium leading-none">
        <bdi>{label}</bdi>
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="bg-secondary flex gap-0.5 self-start rounded-xl p-0.5"
        {...aria}
      >
        {options.map((option) => (
          <label key={option.value} className="relative cursor-pointer">
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              className="peer sr-only"
              onChange={() => onChange(option.value)}
            />
            <span className="text-secondary-foreground peer-checked:bg-card peer-checked:text-foreground peer-focus-visible:ring-ring block rounded-lg px-3 py-1 text-sm peer-checked:font-medium peer-checked:shadow-sm peer-focus-visible:ring-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-60">
              {option.label}
            </span>
          </label>
        ))}
      </div>
      <FieldError id={id} error={error} />
    </div>
  );
}
