"use client";

import { useRef, type ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@platform/ui";

/**
 * The shell every Users dialog shares: a real `Dialog` with a title and a description, Escape and
 * the close button always working (also while a request is in flight: the owner keeps the request),
 * and an initial-focus rule — `cancel` for the destructive confirms (never on the destructive
 * button), `field` (the first field) for the forms. Where focus goes on close is the owner's call
 * (`onCloseAutoFocus`): the trigger it names must still be mounted.
 */
export function StaffDialog({
  open,
  onOpenChange,
  title,
  description,
  initialFocus,
  onCloseAutoFocus,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: ReactNode;
  readonly initialFocus: "cancel" | "field";
  readonly onCloseAutoFocus: (event: Event) => void;
  readonly children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        onOpenAutoFocus={(event) => {
          if (initialFocus !== "cancel") return;
          event.preventDefault();
          content.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Cancel + the primary button. The primary is busy and disabled while pending; Cancel never is. */
export function StaffDialogFooter({
  cancelLabel,
  submitLabel,
  pendingLabel,
  pending,
  destructive,
  submitType,
  onCancel,
  onSubmit,
}: {
  readonly cancelLabel: string;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly pending: boolean;
  readonly destructive: boolean;
  readonly submitType: "button" | "submit";
  readonly onCancel: () => void;
  readonly onSubmit?: () => void;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" data-initial-focus="" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button
        type={submitType}
        variant={destructive ? "destructive" : "primary"}
        loading={pending}
        disabled={pending}
        {...(onSubmit === undefined ? {} : { onClick: onSubmit })}
      >
        {pending ? pendingLabel : submitLabel}
      </Button>
    </DialogFooter>
  );
}

/** A refusal shown inside the open dialog. */
export function DialogError({ message }: { readonly message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}
