"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { PencilIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Label,
} from "@platform/ui";
import { saveOrderNoteAction } from "@/app/orders/annotation-actions";
import type { FormState } from "@/lib/api/mutation";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { characterCount, MAX_NOTE_LENGTH } from "@/lib/orders/order-tags";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * Shopify's Notes card, first in the order page's right column: the note (line breaks kept) or "No
 * notes"; a pencil opens a dialog with a textarea, saved through `saveOrderNoteAction`. `canEdit` is
 * decided on the server from the role (`orders:edit_note`).
 */
export function OrderNotesCard({
  orderId,
  note,
  canEdit,
  locale,
  t,
}: {
  readonly orderId: string;
  readonly note: string | null;
  readonly canEdit: boolean;
  readonly locale: Locale;
  readonly t: Dictionary;
}) {
  const n = t.orderNotes;
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveOrderNoteAction, INITIAL_STATE);
  const [length, setLength] = useState(() => characterCount(note ?? ""));
  const tooLong = length > MAX_NOTE_LENGTH;
  const fieldError =
    state.status === "error" && state.fieldErrors["note"] !== undefined
      ? state.fieldErrors["note"]
      : tooLong
        ? n.tooLong
        : undefined;
  const counter = n.counter
    .replace("{count}", () => formatNumber(locale, length))
    .replace("{max}", () => formatNumber(locale, MAX_NOTE_LENGTH));

  const changeOpen = (next: boolean) => {
    // The textarea restarts from the saved note each time the dialog opens.
    if (next) setLength(characterCount(note ?? ""));
    setOpen(next);
  };

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{n.title}</CardTitle>
        {canEdit && (
          <Dialog open={open} onOpenChange={changeOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="ghost" size="sm" aria-label={n.edit} title={n.edit}>
                <PencilIcon aria-hidden="true" className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{n.dialogTitle}</DialogTitle>
              </DialogHeader>
              <form
                action={formAction}
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  // Counted in characters as a person counts them (an emoji is one); the server re-checks.
                  if (tooLong) event.preventDefault();
                }}
              >
                <input type="hidden" name="orderId" value={orderId} />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${formId}-note`}>{n.label}</Label>
                  <textarea
                    id={`${formId}-note`}
                    name="note"
                    rows={6}
                    defaultValue={note ?? ""}
                    dir="auto"
                    onChange={(event) => setLength(characterCount(event.target.value))}
                    aria-invalid={fieldError !== undefined || undefined}
                    className="border-input bg-card focus-visible:ring-ring min-h-32 w-full rounded-xl border px-3.5 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
                  />
                  <p className="text-muted-foreground text-end text-xs">{counter}</p>
                  {fieldError !== undefined && (
                    <p className="text-destructive text-sm">{fieldError}</p>
                  )}
                </div>
                {state.status === "error" && fieldError === undefined && (
                  <p role="alert" className="text-destructive text-sm">
                    {state.message}
                  </p>
                )}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    {n.cancel}
                  </Button>
                  <Button type="submit" loading={isPending} disabled={isPending}>
                    {isPending ? n.saving : n.save}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {note === null ? (
          <p className="text-muted-foreground text-sm">{n.empty}</p>
        ) : (
          <p dir="auto" className="whitespace-pre-wrap text-sm">
            {note}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
