"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { focusRing } from "../../lib/focus";

/**
 * Lumo Dialog — Radix underneath, which supplies the focus management the design system
 * requires: focus moves into the dialog on open, is trapped while it is open, returns to
 * the trigger on close, and the rest of the page is inert to assistive tech.
 *
 * `DialogTitle` is mandatory (Radix warns without one). Use `DialogDescription` whenever
 * the dialog needs explanation beyond its title.
 */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "bg-foreground/40 fixed inset-0 z-50",
      "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * `center` is the dialog proper. `inline-start` is the drawer: it docks to the leading
 * edge, which is the left in LTR and the right in RTL — expressed with logical properties
 * so no RTL override is needed.
 */
export type DialogPosition = "center" | "inline-start";

const POSITION_CLASSES: Readonly<Record<DialogPosition, string>> = {
  // Centred with `inset-0` + auto margins rather than a translate, so RTL never has to
  // fight a transform and the entry animation can stay transform-free.
  center: cn(
    "inset-0 m-auto h-fit max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto",
    "rounded-3xl border border-border/60 p-6 shadow-xl",
    "data-[state=open]:animate-surface-in data-[state=closed]:animate-surface-out",
  ),
  "inline-start": cn(
    "inset-y-0 start-0 h-dvh w-[min(20rem,85vw)] overflow-y-auto",
    "border-e border-border shadow-xl",
    "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
  ),
};

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    position?: DialogPosition;
  }
>(({ className, children, position = "center", ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "bg-popover text-popover-foreground fixed z-50 grid gap-4",
        POSITION_CLASSES[position],
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className={cn(
          "text-muted-foreground absolute end-4 top-4 rounded-sm p-1",
          "duration-(--duration-fast) hover:bg-accent hover:text-foreground transition-colors ease-out",
          focusRing,
        )}
      >
        <XIcon className="size-4" aria-hidden="true" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 text-start", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-xl font-semibold leading-none", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-muted-foreground text-base", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
