"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Button, Label } from "@platform/ui";
import { deleteOrderCommentAction, editOrderCommentAction } from "@/app/orders/annotation-actions";
import type { FormState } from "@/lib/api/mutation";
import type { TimelineEntryDto } from "@/lib/api/orders";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/** Keeps a staff name's own direction from reordering the "name · time" line around it. */
function isolate(text: string): string {
  return `⁨${text}⁩`;
}

/**
 * One staff comment on the timeline: text, author · time (· Edited), and — only when the API says so
 * (`canEdit`/`canDelete`) — Edit (in place) and Delete (after a confirmation). A `<li>` whose first
 * paragraph is the text, like every other timeline line.
 */
export function OrderCommentItem({
  orderId,
  entry,
  t,
  locale,
}: {
  readonly orderId: string;
  readonly entry: TimelineEntryDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const c = t.orderComments;
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [editState, editAction, editPending] = useActionState(
    editOrderCommentAction,
    INITIAL_STATE,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteOrderCommentAction,
    INITIAL_STATE,
  );

  useEffect(() => {
    if (editState.status === "success") setEditing(false);
  }, [editState]);

  const error =
    editState.status === "error"
      ? (editState.fieldErrors["body"] ?? editState.message)
      : deleteState.status === "error"
        ? deleteState.message
        : null;
  const byline = [
    isolate(entry.authorName ?? t.orderTimeline.staff),
    formatDateTime(locale, entry.createdAt),
    ...(entry.editedAt === null ? [] : [c.edited]),
  ].join(" · ");

  return (
    <li className="flex items-start gap-3">
      <span aria-hidden="true" className="bg-border mt-1.5 size-2.5 shrink-0 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {editing ? (
          <form action={editAction} className="flex flex-col gap-2">
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="entryId" value={entry.id} />
            <Label htmlFor={id} className="sr-only">
              {c.label}
            </Label>
            <textarea
              id={id}
              name="body"
              dir="auto"
              rows={2}
              defaultValue={entry.body ?? ""}
              className="border-input bg-card focus-visible:ring-ring w-full rounded-xl border px-3.5 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={editPending} disabled={editPending}>
                {c.save}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {c.cancel}
              </Button>
            </div>
          </form>
        ) : (
          <p dir="auto" className="whitespace-pre-wrap break-words text-sm">
            {entry.body}
          </p>
        )}
        <p className="text-muted-foreground text-xs">{byline}</p>
        {!editing && (entry.canEdit || entry.canDelete) && (
          <div className="flex gap-2">
            {entry.canEdit && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
                {c.edit}
              </Button>
            )}
            {entry.canDelete && (
              <form
                action={deleteAction}
                onSubmit={(event) => {
                  if (!window.confirm(c.confirmDelete)) event.preventDefault();
                }}
              >
                <input type="hidden" name="orderId" value={orderId} />
                <input type="hidden" name="entryId" value={entry.id} />
                <Button type="submit" size="sm" variant="ghost" disabled={deletePending}>
                  {c.delete}
                </Button>
              </form>
            )}
          </div>
        )}
        {error !== null && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
