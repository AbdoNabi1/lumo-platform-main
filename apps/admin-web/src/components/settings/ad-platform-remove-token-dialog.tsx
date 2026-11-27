"use client";

import { useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * "Remove token" behind a real confirm `Dialog`: a title, a description that says what stops, initial
 * focus on Cancel (never on the destructive button), Escape closes and focus goes back to the trigger,
 * which stays mounted while the dialog is open. Confirming closes it and hands over to the card, which
 * submits the removal (`clearSecret`) like any save. The vendor's name is read out with the trigger so
 * five identical buttons are told apart.
 */
export function AdPlatformRemoveTokenDialog({
  vendor,
  disabled,
  onConfirm,
  t,
}: {
  readonly vendor: string;
  readonly disabled: boolean;
  readonly onConfirm: () => void;
  readonly t: Dictionary;
}) {
  const copy = t.adPlatformsSettings;
  const [open, setOpen] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          {copy.removeToken}
          <span className="sr-only">
            {" "}
            <bdi dir="auto">{vendor}</bdi>
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{copy.removeTitle}</DialogTitle>
          <DialogDescription>{copy.removeBody}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button ref={cancel} type="button" variant="outline" onClick={() => setOpen(false)}>
            {copy.removeCancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {copy.removeConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
