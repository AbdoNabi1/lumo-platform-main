"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { Label, cn } from "@platform/ui";

/** The `id` of the editor's one `<form>`. Every input in a form card joins it with `form=`. */
export const PRODUCT_FORM_ID = "product-editor";

const CONTROL_CLASS =
  "border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) rounded-md border text-sm transition-colors ease-out aria-invalid:border-destructive";

interface FieldControlProps {
  readonly id: string;
  readonly name: string;
  readonly form: string | undefined;
  readonly "aria-invalid": true | undefined;
  readonly "aria-describedby": string | undefined;
}

/**
 * Label + control + hint + error. The control is a render prop so every kind of input (text,
 * select, textarea) gets the same id, `aria-invalid` and `aria-describedby` wiring.
 */
export function Field({
  label,
  name,
  error,
  hint,
  form,
  className,
  children,
}: {
  readonly label: string;
  readonly name: string;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  readonly form?: string | undefined;
  readonly className?: string | undefined;
  readonly children: (control: FieldControlProps) => ReactNode;
}) {
  const base = useId();
  const id = `${base}-${name}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error !== undefined ? errorId : null, hint !== undefined ? hintId : null]
      .filter((value) => value !== null)
      .join(" ") || undefined;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        name,
        form,
        "aria-invalid": error !== undefined ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {hint !== undefined && (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(CONTROL_CLASS, "h-9 px-2", className)} {...props} />;
}

export function NativeTextarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(CONTROL_CLASS, "min-h-32 w-full p-3", className)} {...props} />;
}

/** A native checkbox with a clickable label; controlled or not, depending on the props given. */
export function CheckboxRow({
  label,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { readonly label: string }) {
  return (
    <label className={cn("flex items-center gap-2 text-sm", className)}>
      <input type="checkbox" className="accent-primary size-4" {...props} />
      {label}
    </label>
  );
}
