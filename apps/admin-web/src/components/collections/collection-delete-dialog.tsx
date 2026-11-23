"use client";

import { useActionState, useRef, useState, type RefObject } from "react";
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
import { deleteCollectionAction } from "@/app/collections/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * Delete collection, behind a real confirm `Dialog`: a title, a description that says what is
 * lost, initial focus on Cancel (never on the destructive button), Escape closes, and focus goes
 * back to the trigger — which stays mounted the whole time so there is something to return to.
 * A refusal (409, 403…) is shown inside the dialog, which stays open; reopening starts clean
 * because the form (and its action state) only exists while the dialog is open.
 */
export function CollectionDeleteDialog({
  collectionId,
  name,
  t,
}: {
  readonly collectionId: string;
  readonly name: string;
  readonly t: Dictionary;
}) {
  const k = t.collections.delete;
  const [open, setOpen] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  // The body names the collection where `{name}` sits, isolated so a mixed-direction name cannot
  // reorder the sentence around it.
  const [before = "", after = ""] = k.body.split("{name}");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
        <DeleteForm
          collectionId={collectionId}
          cancel={cancel}
          onCancel={() => setOpen(false)}
          t={t}
        />
      </DialogContent>
    </Dialog>
  );
}

function DeleteForm({
  collectionId,
  cancel,
  onCancel,
  t,
}: {
  readonly collectionId: string;
  readonly cancel: RefObject<HTMLButtonElement | null>;
  readonly onCancel: () => void;
  readonly t: Dictionary;
}) {
  const k = t.collections.delete;
  const [state, formAction, isPending] = useActionState(deleteCollectionAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="collectionId" value={collectionId} />
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
      <DialogFooter>
        <Button
          ref={cancel}
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={onCancel}
        >
          {k.cancel}
        </Button>
        <Button type="submit" variant="destructive" loading={isPending} disabled={isPending}>
          {isPending ? k.deleting : k.confirm}
        </Button>
      </DialogFooter>
    </form>
  );
}
