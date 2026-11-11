"use client";

import { useState } from "react";
import { Input, Label } from "@platform/ui";
import { toWhatsAppDigits } from "@platform/storefront-content";
import { errorAria, FieldError } from "./field-shared";

const show = (digits: string) => (digits === "" ? "" : `+${digits}`);

/**
 * A WhatsApp number. What is typed is kept as typed; a number the shared rule accepts is stored as
 * its digits straight away, and on blur the box shows the normalised `+<digits>`. A number the rule
 * refuses is flagged inline on blur and not stored (the draft keeps the last good number), never
 * for an empty box (an empty phone is allowed; the storefront just drops the button).
 */
export function PhoneField({
  id,
  label,
  hint,
  invalidCopy,
  value,
  disabled,
  error,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly invalidCopy: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly error?: string | undefined;
  readonly onChange: (digits: string) => void;
}) {
  const [text, setText] = useState(show(value));
  const [synced, setSynced] = useState(value);
  const [bad, setBad] = useState(false);
  // A value that arrives from outside (a reload) replaces the text; our own echo does not.
  if (synced !== value) {
    setSynced(value);
    if (toWhatsAppDigits(text) !== value) {
      setText(show(value));
      setBad(false);
    }
  }
  const shownError = bad ? invalidCopy : error;
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        <bdi>{label}</bdi>
      </Label>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        dir="ltr"
        autoComplete="off"
        value={text}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          setText(raw);
          setBad(false);
          if (raw.trim() === "") onChange("");
          else {
            const digits = toWhatsAppDigits(raw);
            if (digits !== null) onChange(digits);
          }
        }}
        onBlur={() => {
          if (text.trim() === "") {
            setBad(false);
            return;
          }
          const digits = toWhatsAppDigits(text);
          if (digits === null) {
            setBad(true);
            return;
          }
          setBad(false);
          setText(show(digits));
          if (digits !== value) onChange(digits);
        }}
        {...errorAria(id, shownError, hintId)}
      />
      <p id={hintId} className="text-muted-foreground text-xs">
        {hint}
      </p>
      <FieldError id={id} error={shownError} />
    </div>
  );
}
