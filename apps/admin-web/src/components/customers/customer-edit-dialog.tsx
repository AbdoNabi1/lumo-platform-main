"use client";

import { useRef, type ReactNode } from "react";
import { PencilIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@platform/ui";

/**
 * The chrome of a customer edit dialog, on the real `Dialog`: a title, a `DialogDescription`,
 * initial focus on the field marked `data-autofocus` (else the first field), Escape and Cancel
 * close it, and focus returns to the trigger — which stays mounted the whole time, so it is
 * still there to receive it. The form lives in `children`, which only mount while the dialog is
 * open: each opening starts from the saved values and a clean state.
 */
export function CustomerEditDialog({
  title,
  description,
  triggerLabel,
  open,
  onOpenChange,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly triggerLabel: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button ref={trigger} type="button" variant="outline" size="sm">
          <PencilIcon aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        ref={content}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const target =
            content.current?.querySelector<HTMLElement>("[data-autofocus]") ??
            content.current?.querySelector<HTMLElement>("input:not([readonly]), textarea, select");
          target?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
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
