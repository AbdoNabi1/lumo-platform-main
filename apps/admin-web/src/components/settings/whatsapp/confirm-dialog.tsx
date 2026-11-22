"use client";

import { useRef, useState, useTransition, type RefObject } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@platform/ui";
import type { WhatsAppActionState } from "@/app/settings/whatsapp/actions";
import { BrandText } from "./brand-text";

/**
 * A destructive confirmation (A7): a title and a description, initial focus on Cancel, Escape closes, focus returns to
 * the trigger, and the trigger stays mounted while the dialog is open. Where the trigger has been removed by the time
 * the dialog closes (the action succeeded and the screen moved on), focus goes to `fallbackFocus` instead of being lost.
 */
export function ConfirmDialog({
  triggerLabel,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
  onResult,
  fallbackFocus,
  triggerVariant = "outline",
}: {
  readonly triggerLabel: string;
  readonly title: string;
  readonly description: string;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => Promise<WhatsAppActionState>;
  readonly onResult: (result: WhatsAppActionState) => void;
  readonly fallbackFocus?: RefObject<HTMLElement | null>;
  readonly triggerVariant?: "outline" | "destructive";
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function confirm() {
    startTransition(async () => {
      const result = await onConfirm();
      setOpen(false);
      onResult(result);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button ref={triggerRef} type="button" variant={triggerVariant}>
          <BrandText text={triggerLabel} />
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (triggerRef.current?.isConnected !== true && fallbackFocus?.current) {
            event.preventDefault();
            fallbackFocus.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            <BrandText text={title} />
          </DialogTitle>
          <DialogDescription>
            <BrandText text={description} />
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            {cancelLabel}
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
            <BrandText text={confirmLabel} />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
