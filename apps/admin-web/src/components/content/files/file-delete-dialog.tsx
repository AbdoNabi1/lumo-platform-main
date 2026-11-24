"use client";

import { useRef, useState } from "react";
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
import { archiveFileAction } from "@/app/content/files/actions";
import type { Dictionary } from "@/messages/en";

/**
 * "Delete file", behind a real confirm `Dialog`: a title, a description saying what is lost, initial
 * focus on Cancel (never on the destructive button), Escape closes, and focus goes back to the
 * trigger — which stays mounted the whole time so there is something to return to. A refusal is shown
 * inside the dialog, which stays open. `onDeleted` runs once the file is archived and this dialog has
 * closed (the details dialog around it closes too).
 */
export function FileDeleteDialog({
  mediaAssetId,
  name,
  t,
  onDeleted,
}: {
  readonly mediaAssetId: string;
  readonly name: string;
  readonly t: Dictionary;
  readonly onDeleted?: () => void;
}) {
  const k = t.files.delete;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  async function confirm(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const state = await archiveFileAction(mediaAssetId);
      if (state.status === "error") {
        setError(state.message);
        return;
      }
      setOpen(false);
      onDeleted?.();
    } catch {
      setError(t.formErrors.unexpected);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A delete in flight cannot be dismissed; the answer decides what happens next.
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          <Trash2Icon aria-hidden="true" />
          {t.files.details.delete}
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
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
          <Button
            ref={cancel}
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            {k.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={pending}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? k.deleting : k.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
