import * as React from "react";
import { cn } from "../../lib/cn";
import { focusRing } from "../../lib/focus";

/** Native textarea with the Input's border, radius and focus ring. Pair with a <Label htmlFor>. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "border-input bg-card text-foreground flex min-h-20 w-full rounded-xl border px-3.5 py-2 text-base",
        "placeholder:text-muted-foreground hover:border-foreground/40",
        "disabled:bg-muted aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-60",
        focusRing,
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
