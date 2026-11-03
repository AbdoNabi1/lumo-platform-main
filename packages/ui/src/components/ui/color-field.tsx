"use client";

import * as React from "react";
import { cn } from "../../lib/cn";
import { Input } from "./input";

const HEX = /^#?([0-9a-fA-F]{6})$/;

export interface ColorFieldProps {
  readonly id: string;
  readonly label: string;
  readonly textLabel: string;
  readonly value: string;
  readonly onChange: (hex: string) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

/** Native colour input plus a hex field. Only `#rrggbb` (lower case) ever leaves this control. */
export function ColorField({
  id,
  label,
  textLabel,
  value,
  onChange,
  disabled,
  className,
}: ColorFieldProps) {
  const [text, setText] = React.useState(value);
  const [invalid, setInvalid] = React.useState(false);
  React.useEffect(() => {
    setText(value);
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const match = HEX.exec(text.trim());
    if (match === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const hex = `#${(match[1] ?? "").toLowerCase()}`;
    if (hex !== value) onChange(hex);
  };
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <input
        id={id}
        type="color"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value.toLowerCase())}
        className="border-input h-9 w-12 shrink-0 cursor-pointer rounded-lg border bg-transparent p-1"
      />
      <Input
        aria-label={textLabel}
        dir="ltr"
        value={text}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className="w-28 font-mono uppercase"
        maxLength={7}
      />
    </div>
  );
}
