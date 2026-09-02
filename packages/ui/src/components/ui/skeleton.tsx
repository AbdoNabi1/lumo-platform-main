import * as React from "react";
import { cn } from "../../lib/cn";

/**
 * Lumo Skeleton — a loading placeholder. `aria-hidden` because the shape carries no
 * information; announce the wait on the region that owns it (`aria-busy`/`aria-live`).
 * The pulse is suppressed automatically under `prefers-reduced-motion`.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("bg-muted animate-pulse rounded-lg", className)}
      {...props}
    />
  );
}

export { Skeleton };
