import * as React from "react";
import { cn } from "../../lib/cn";
import { focusRing } from "../../lib/focus";

/**
 * Morbeh Input. 16px radius, 36px tall, `--input` border (held at ≥3:1 against its surface),
 * and the shared focus ring (resolves to the brand purple). Always pair with a
 * `<Label htmlFor>` — a placeholder is not a label.
 */
export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "border-input bg-card text-foreground flex h-9 w-full rounded-xl border px-3.5 text-base",
        "duration-(--duration-fast) transition-[border-color,box-shadow] ease-out",
        "placeholder:text-muted-foreground",
        "hover:border-foreground/40",
        "disabled:bg-muted disabled:cursor-not-allowed disabled:opacity-60",
        "aria-invalid:border-destructive aria-invalid:outline-destructive",
        "file:border-0 file:bg-transparent file:text-base file:font-medium",
        focusRing,
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
