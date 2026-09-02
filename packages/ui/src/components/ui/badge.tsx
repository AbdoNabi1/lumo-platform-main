import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

/**
 * Lumo Badge.
 *
 * Status variants carry the platform's semantic meaning and must stay consistent
 * everywhere they appear — admin, storefront, orders, payments, inventory, checkout,
 * analytics, customer areas. `success` is always "settled/healthy", `warning` always
 * "needs attention", `destructive` always "failed/reversed", `info` always "in progress".
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "bg-secondary text-secondary-foreground",
        accent: "bg-primary-subtle text-primary-subtle-foreground",
        success: "bg-success-subtle text-success-foreground",
        warning: "bg-warning-subtle text-warning-foreground",
        destructive: "bg-destructive-subtle text-destructive-subtle-foreground",
        info: "bg-info-subtle text-info-foreground",
        outline: "border border-border-strong text-secondary-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
