"use client";

import { useRef, useState, useTransition } from "react";
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
import { deleteSegmentAction } from "@/app/customers/segments/actions";
import type { Dictionary } from "@/messages/en";

/**
 * Delete segment, behind a real confirm `Dialog`: a title, a description that names the segment and
 * says what is (not) lost, initial focus on Cancel (never on the destructive button), Escape and
 * Cancel close it, and focus goes back to the trigger — which stays mounted so there is something to
 * return to. A refusal (a stale 409, a 403…) shows inside the open dialog; success redirects to the
 * list from the server action. Reopening starts clean.
 */
export function SegmentDeleteDialog({
  segmentId,
  version,
  name,
  t,
}: {
  readonly segmentId: string;
  readonly version: number;
  readonly name: string;
  readonly t: Dictionary;
}) {
  const k = t.segments.delete;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cancel = useRef<HTMLButtonElement>(null);
  // The description names the segment where `{name}` sits, isolated so a mixed-direction name
  // cannot reorder the sentence around it.
  const [before = "", after = ""] = k.body.split("{name}");

  function confirm(): void {
    startTransition(async () => {
      const result = await deleteSegmentAction(segmentId, version);
      if (result.status === "error") setError(result.message);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          <Trash2Icon aria-hidden="true" />
          {k.trigger}
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
          <DialogDescription>
            {before}
            <bdi dir="auto" className="text-foreground font-medium">
              {name}
            </bdi>
            {after}
          </DialogDescription>
        </DialogHeader>
        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button ref={cancel} type="button" variant="outline" onClick={() => setOpen(false)}>
            {k.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={pending}
            disabled={pending}
            onClick={confirm}
          >
            {pending ? k.deleting : k.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
