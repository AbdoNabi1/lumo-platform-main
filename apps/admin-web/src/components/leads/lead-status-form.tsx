"use client";

import { useActionState, useId } from "react";
import { Button, Label, NativeSelect } from "@platform/ui";
import { changeLeadStatusAction } from "@/app/leads/actions";
import type { FormState } from "@/lib/api/mutation";
import { LEAD_STATUSES } from "@/lib/leads/lead-status";
import type { Dictionary } from "@/messages/en";
import { LeadStatusBadge } from "./lead-status-badge";

const INITIAL_STATE: FormState = { status: "idle" };

function EditableStatusForm({
  leadId,
  status,
  t,
}: {
  readonly leadId: string;
  readonly status: string;
  readonly t: Dictionary;
}) {
  const [state, formAction, isPending] = useActionState(changeLeadStatusAction, INITIAL_STATE);
  const selectId = useId();

  return (
    <form action={formAction} className="flex flex-col items-start gap-3">
      <input type="hidden" name="leadId" value={leadId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={selectId} className="text-muted-foreground text-sm">
            {t.leadDetail.statusLabel}
          </Label>
          <NativeSelect id={selectId} name="status" defaultValue={status} className="w-56">
            {LEAD_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t.leadStatus[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" loading={isPending} disabled={isPending}>
          {isPending ? t.leadDetail.saving : t.leadDetail.save}
        </Button>
      </div>
      {state.status === "success" && (
        <p
          role="status"
          className="bg-success-subtle text-success-foreground rounded-lg px-3 py-2 text-sm"
        >
          {t.leadDetail.saved}
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
    </form>
  );
}

/**
 * The lead's status control on the detail page: a select + Save for operators and admins, and the
 * status as a badge with a short note for a viewer (the API would refuse their write anyway).
 */
export function LeadStatusForm({
  leadId,
  status,
  canEdit,
  t,
}: {
  readonly leadId: string;
  readonly status: string;
  readonly canEdit: boolean;
  readonly t: Dictionary;
}) {
  if (!canEdit) {
    return (
      <div className="flex flex-col items-start gap-2">
        <LeadStatusBadge status={status} t={t} />
        <p className="text-muted-foreground text-sm">{t.leadDetail.readOnly}</p>
      </div>
    );
  }
  return <EditableStatusForm leadId={leadId} status={status} t={t} />;
}
