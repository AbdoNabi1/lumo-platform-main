import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";
import { focusRing } from "../../lib/focus";

/**
 * Morbeh Card.
 *
 * The default is a soft, spacious surface: 20px radius, a hairline border, and the
 * restrained brand-tinted `shadow-card` that makes every card read as gently floating
 * above the canvas. `elevated` opts into a stronger shadow for surfaces that must read
 * above the rest (e.g. a card floating over other cards); `interactive`/`kpi` add the
 * hover lift for cards that are themselves a control or carry live data.
 */
const cardVariants = cva(
  "rounded-2xl border border-border/60 bg-card text-card-foreground shadow-card transition-[box-shadow,transform] duration-(--duration-normal) ease-out",
  {
    variants: {
      variant: {
        default: "",
        bordered: "border-border-strong shadow-none",
        elevated: "shadow-xl",
        interactive: cn("cursor-pointer hover:-translate-y-0.5 hover:shadow-card-hover", focusRing),
        kpi: "hover:-translate-y-0.5 hover:shadow-card-hover",
        compact: "",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface CardProps extends React.ComponentProps<"div">, VariantProps<typeof cardVariants> {}

function Card({ className, variant, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      // Wraps rather than forcing a min-content width: a header with a long title and a
      // trailing action must not be what makes a card too wide for its column.
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-5",
        className,
      )}
      {...props}
    />
  );
}

/** Renders an `<h3>` by default — override with `as` when the heading level differs. */
function CardTitle({
  className,
  as: Comp = "h3",
  ...props
}: React.ComponentProps<"h3"> & { as?: "h2" | "h3" | "h4" | "div" }) {
  return <Comp className={cn("text-lg font-semibold leading-none", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-muted-foreground text-base", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-4 pb-4 sm:px-5 sm:pb-5", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("border-border flex items-center gap-3 border-t px-4 py-3 sm:px-5", className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, cardVariants };
