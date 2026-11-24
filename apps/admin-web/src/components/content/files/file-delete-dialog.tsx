"use client";

import { useRef, type RefObject } from "react";
import { Trash2Icon } from "lucide-react";
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
 * "Delete file", behind a real confirm `Dialog`: a title, a description saying what is lost, initial
 * focus on Cancel (never on the destructive button), Escape closes — also while a delete is in
 * flight — and the trigger stays mounted so focus has somewhere to go. This is a controlled view:
 * `FilesBrowser` owns `open`, the in-flight operation and its outcome, so dismissing the dialog never
 * cancels or forgets the request, and a refusal is shown here while the dialog stays open.
 */
export function FileDeleteDialog({
  name,
  t,
  open,
  onOpenChange,
  pending,
  error,
  onConfirm,
  onCloseAutoFocus,
  triggerRef,
}: {
  readonly name: string;
  readonly t: Dictionary;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onConfirm: () => void;
  readonly onCloseAutoFocus: (event: Event) => void;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const k = t.files.delete;
  const cancel = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button ref={triggerRef} type="button" variant="destructive" size="sm">
          <Trash2Icon aria-hidden="true" />
          {t.files.details.delete}
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{k.title}</DialogTitle>
          <DialogDescription>{k.body}</DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium">
          <bdi dir="auto">{name}</bdi>
        </p>
        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button ref={cancel} type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {k.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={pending}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? k.deleting : k.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
