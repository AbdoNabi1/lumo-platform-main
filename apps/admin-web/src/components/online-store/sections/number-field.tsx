"use client";

import { useState } from "react";
import { Input, Label } from "@platform/ui";
import { errorAria, FieldError } from "./field-shared";

/**
 * A slider and a number box over one value, with the descriptor's `min`/`max`/`step`. The slider is
 * labelled by the field; the box says "<field> value". A typed number outside the range (or off
 * the step) is only applied when it fits; on blur it is clamped and snapped, so the stored value is
 * always one the shared validator accepts.
 */
export function NumberField({
  id,
  label,
  valueLabel,
  min,
  max,
  step,
  value,
  disabled,
  error,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly valueLabel: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly disabled: boolean;
  readonly error?: string | undefined;
  readonly onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // Re-sync on a changed value (the slider, a reload), during render.
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setText(String(value));
  }
  const snap = (n: number) =>
    Math.min(max, Math.max(min, min + Math.round((n - min) / step) * step));
  const fits = (n: number) => Number.isInteger(n) && n >= min && n <= max && (n - min) % step === 0;
  const aria = errorAria(id, error);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${id}-range`}>
        <bdi>{label}</bdi>
      </Label>
      <div className="flex items-center gap-3">
        <input
          id={`${id}-range`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          className="accent-primary w-full"
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          {...aria}
        />
        <Input
          type="number"
          inputMode="numeric"
          aria-label={valueLabel}
          min={min}
          max={max}
          step={step}
          value={text}
          disabled={disabled}
          className="w-24 shrink-0"
          onChange={(e) => {
            const raw = e.currentTarget.value;
            setText(raw);
            const n = raw.trim() === "" ? Number.NaN : Number(raw);
            if (fits(n) && n !== value) onChange(n);
          }}
          onBlur={() => {
            const n = text.trim() === "" ? Number.NaN : Number(text);
            if (!Number.isFinite(n)) {
              setText(String(value));
              return;
            }
            const next = snap(n);
            setText(String(next));
            if (next !== value) onChange(next);
          }}
          {...aria}
        />
      </div>
      <FieldError id={id} error={error} />
    </div>
  );
}
