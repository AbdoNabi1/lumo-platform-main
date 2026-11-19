import * as React from "react";
import { cn } from "../../lib/cn";
import { focusRing } from "../../lib/focus";

/** The native <select> (accessible, RTL-correct, no dependency), styled like Input. */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "border-input bg-card text-foreground flex h-9 w-full rounded-xl border px-3 text-base",
        "hover:border-foreground/40 disabled:bg-muted disabled:cursor-not-allowed disabled:opacity-60",
        focusRing,
        className,
      )}
      {...props}
    />
  ),
);
NativeSelect.displayName = "NativeSelect";
