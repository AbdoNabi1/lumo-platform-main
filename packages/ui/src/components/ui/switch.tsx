"use client";

import * as React from "react";
import { cn } from "../../lib/cn";
import { focusRing } from "../../lib/focus";

export interface SwitchProps extends Omit<
  React.ComponentProps<"input">,
  "type" | "role" | "onChange"
> {
  readonly onCheckedChange?: (checked: boolean) => void;
}

/** A checkbox with `role="switch"`: submits like a checkbox (`name=on`), reads as a switch. */
export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, onCheckedChange, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      role="switch"
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
      className={cn(
        "bg-border-strong checked:bg-primary relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full transition-colors",
        "before:bg-card before:absolute before:start-0.5 before:top-0.5 before:size-4 before:rounded-full before:transition-transform",
        "checked:before:translate-x-4 disabled:cursor-not-allowed disabled:opacity-60 rtl:checked:before:-translate-x-4",
        focusRing,
        className,
      )}
      {...props}
    />
  ),
);
Switch.displayName = "Switch";
