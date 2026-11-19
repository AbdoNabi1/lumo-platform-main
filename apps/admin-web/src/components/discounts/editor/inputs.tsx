"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { Card, CardContent, Input, Label, cn } from "@platform/ui";
import type { DiscountFormValues } from "@/lib/discounts/form";
import type { Dictionary } from "@/messages/en";

/** What every form card receives: the form, a way to change it, the errors by field, the copy. */
export interface CardProps {
  readonly values: DiscountFormValues;
  readonly set: (patch: Partial<DiscountFormValues>) => void;
  readonly errors: Readonly<Record<string, string>>;
  readonly t: Dictionary;
}

/** A form card with Shopify's bold heading. */
export function FormCard({
  title,
  aside,
  children,
}: {
  readonly title: string;
  /** Shown at the heading's end, e.g. the discount class. */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {aside}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Names a set of native radios. The label is read by assistive tech; `visible` also shows it (use
 * it when the card has no heading saying the same thing).
 */
export function RadioGroup({
  label,
  visible = false,
  className,
  children,
}: {
  readonly label: string;
  readonly visible?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const labelId = useId();
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      className={cn("flex flex-col gap-2", className)}
    >
      <span id={labelId} className={visible ? "text-sm" : "sr-only"}>
        {label}
      </span>
      {children}
    </div>
  );
}

/** A native radio with its label. */
export function RadioRow({
  label,
  className,
  children,
  ...props
}: Omit<ComponentProps<"input">, "type"> & {
  readonly label: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" className="accent-primary size-4" {...props} />
        {label}
      </label>
      {children !== undefined && props.checked === true && <div className="ps-6">{children}</div>}
    </div>
  );
}

/** A field's error under it; `id` ties it to the input's `aria-describedby`. */
export function ErrorText({
  id,
  message,
}: {
  readonly id: string;
  readonly message?: string | undefined;
}) {
  if (message === undefined) return null;
  return (
    <p id={id} className="text-destructive text-xs">
      {message}
    </p>
  );
}

/** Label + text input + hint + error, controlled. */
export function TextField({
  label,
  value,
  onValueChange,
  error,
  hint,
  inputMode,
  type = "text",
  className,
  end,
  maxLength,
  dir,
  autoCapitalize,
  spellCheck,
}: {
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  readonly inputMode?: ComponentProps<"input">["inputMode"];
  readonly type?: "text" | "date" | "time";
  readonly className?: string;
  /** Something after the input on the same line (a "%" sign, a button). */
  readonly end?: ReactNode;
  readonly maxLength?: number;
  /** "ltr" for Latin-only values (codes) that stay left to right in the Arabic UI. */
  readonly dir?: "ltr" | "rtl";
  readonly autoCapitalize?: ComponentProps<"input">["autoCapitalize"];
  readonly spellCheck?: boolean;
}) {
  const id = useId();
  const describedBy = [
    error === undefined ? null : `${id}-error`,
    hint === undefined ? null : `${id}-hint`,
  ]
    .filter((value) => value !== null)
    .join(" ");
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type={type}
          inputMode={inputMode}
          maxLength={maxLength}
          dir={dir}
          autoCapitalize={autoCapitalize}
          spellCheck={spellCheck}
          value={value}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          onChange={(event) => onValueChange(event.target.value)}
        />
        {end}
      </div>
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      <ErrorText id={`${id}-error`} message={error} />
    </div>
  );
}
