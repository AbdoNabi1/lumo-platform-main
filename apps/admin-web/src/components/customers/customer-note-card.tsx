"use client";

import { useActionState, useCallback, useEffect, useId, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DialogFooter,
  Label,
  Textarea,
} from "@platform/ui";
import { setCustomerNoteAction } from "@/app/customers/actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";
import { CustomerEditDialog } from "./customer-edit-dialog";

const INITIAL_STATE: FormState = { status: "idle" };

/** The customer's staff note. Operators and up get "Edit" (a real dialog; saving an empty note clears it); viewers only read it. */
export function CustomerNoteCard({
  customerId,
  note,
  canEdit,
  t,
}: {
  readonly customerId: string;
  readonly note: string | null;
  readonly canEdit: boolean;
  readonly t: Dictionary;
}) {
  const n = t.customerDetail.notes;
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{n.title}</CardTitle>
        {canEdit && (
          <CustomerEditDialog
            title={n.editTitle}
            description={n.editDescription}
            triggerLabel={n.edit}
            open={open}
            onOpenChange={setOpen}
          >
            <NoteForm customerId={customerId} note={note} t={t} onDone={close} onCancel={close} />
          </CustomerEditDialog>
        )}
      </CardHeader>
      <CardContent>
        {note === null ? (
          <p className="text-muted-foreground text-sm">{n.empty}</p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm">
            <bdi dir="auto">{note}</bdi>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function NoteForm({
  customerId,
  note,
  t,
  onDone,
  onCancel,
}: {
  readonly customerId: string;
  readonly note: string | null;
  readonly t: Dictionary;
  readonly onDone: () => void;
  readonly onCancel: () => void;
}) {
  const k = t.customerForm;
  const formId = useId();
  const [state, formAction, isPending] = useActionState(
    setCustomerNoteAction.bind(null, customerId),
    INITIAL_STATE,
  );
  const [value, setValue] = useState(note ?? "");
  const fieldError = state.status === "error" ? state.fieldErrors["note"] : undefined;

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-note`}>{t.customerDetail.notes.label}</Label>
        <Textarea
          id={`${formId}-note`}
          name="note"
          dir="auto"
          rows={5}
          data-autofocus=""
          value={value}
          aria-invalid={fieldError !== undefined || undefined}
          aria-describedby={fieldError !== undefined ? `${formId}-note-error` : undefined}
          onChange={(event) => setValue(event.target.value)}
        />
        {fieldError !== undefined && (
          <p id={`${formId}-note-error`} className="text-destructive text-sm">
            {fieldError}
          </p>
        )}
      </div>
      {state.status === "error" && fieldError === undefined && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {k.cancel}
        </Button>
        <Button type="submit" loading={isPending} disabled={isPending}>
          {isPending ? k.saving : k.saveChanges}
        </Button>
      </DialogFooter>
    </form>
  );
}
