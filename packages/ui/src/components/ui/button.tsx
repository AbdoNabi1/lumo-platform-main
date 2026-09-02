import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2Icon } from "lucide-react";
import { cn } from "../../lib/cn";
import { focusRing } from "../../lib/focus";

/**
 * Lumo Button.
 *
 * Six variants, four sizes, and the six states the design system defines
 * (default / hover / active / focus / disabled / loading). Colour comes only from tokens —
 * `primary` resolves to `--primary` (#635BFF) with `--primary-foreground` on top. Every
 * variant gets the same tactile micro-interaction: a barely-there scale on hover/press,
 * so the whole button system feels soft rather than static.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl",
    "font-medium transition-[background-color,color,box-shadow,transform] duration-(--duration-fast) ease-out",
    "hover:scale-[1.01] active:scale-[0.98]",
    "disabled:pointer-events-none disabled:opacity-50 disabled:hover:scale-100",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    focusRing,
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover hover:shadow-md active:bg-primary-active",
        secondary: "bg-secondary text-secondary-foreground hover:bg-border active:bg-border-strong",
        outline:
          "border border-border-strong bg-card text-foreground hover:bg-accent hover:text-accent-foreground active:bg-secondary",
        ghost: "text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
        destructive:
          "bg-destructive-subtle text-destructive-subtle-foreground hover:bg-destructive hover:text-destructive-foreground active:opacity-90",
        link: "text-primary underline-offset-4 hover:underline hover:scale-100 active:scale-100",
      },
      size: {
        sm: "h-8 px-3 text-xs [&_svg]:size-4",
        md: "h-9 px-4 text-base [&_svg]:size-5",
        lg: "h-10 px-6 text-lg [&_svg]:size-5",
        icon: "size-9 [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render the styling onto the single child element instead of a `<button>`. */
  asChild?: boolean;
  /**
   * Show the loading state: a spinner replaces any leading icon, the button is disabled,
   * and `aria-busy` announces the wait. Ignored when `asChild` is set, since Slot must
   * forward to exactly one child.
   */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) => {
    if (asChild) {
      return (
        // Slot forwards onto an arbitrary element, which may not support `disabled` — an
        // anchor never does. Express the state with ARIA instead so it still reaches
        // assistive tech, and let the variant's disabled styling do the rest.
        <Slot
          ref={ref}
          className={cn(
            buttonVariants({ variant, size, className }),
            disabled && "pointer-events-none opacity-50",
          )}
          aria-disabled={disabled || undefined}
          {...props}
        >
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
        disabled={loading || disabled}
        aria-busy={loading || undefined}
      >
        {loading && <Loader2Icon className="animate-spin" aria-hidden="true" />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
