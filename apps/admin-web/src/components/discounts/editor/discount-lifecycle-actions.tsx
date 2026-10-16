"use client";

import { useActionState } from "react";
import { Button } from "@platform/ui";
import { deleteDiscountAction, setDiscountActiveAction } from "@/app/discounts/actions";
import type { DiscountDto } from "@/lib/api/discounts";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * Deactivate / Activate and Delete, each a small form of its own beside the editor's form (never
 * inside it). Activate is offered only for a discount that was deactivated — expired while its end
 * date, if any, has not passed — since activating one that ended by date would change nothing.
 */
export function DiscountLifecycleActions({
  discount,
  t,
  now = new Date(),
}: {
  readonly discount: DiscountDto;
  readonly t: Dictionary;
  readonly now?: Date;
}) {
  const copy = t.discounts.form;
  const [toggleState, toggleAction, toggling] = useActionState(
    setDiscountActiveAction,
    INITIAL_STATE,
  );
  const [deleteState, deleteAction, deleting] = useActionState(deleteDiscountAction, INITIAL_STATE);
  const ended = discount.endsAt !== null && Date.parse(discount.endsAt) <= now.getTime();
  const canDeactivate = discount.status === "active" || discount.status === "scheduled";
  const canActivate = discount.status === "expired" && !ended;
  const error =
    toggleState.status === "error"
      ? toggleState.message
      : deleteState.status === "error"
        ? deleteState.message
        : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(canDeactivate || canActivate) && (
        <form action={toggleAction}>
          <input type="hidden" name="discountId" value={discount.id} />
          <input type="hidden" name="active" value={canActivate ? "true" : "false"} />
          <Button type="submit" variant="outline" size="sm" loading={toggling} disabled={toggling}>
            {canActivate ? copy.activate : copy.deactivate}
          </Button>
        </form>
      )}
      <form
        action={deleteAction}
        onSubmit={(event) => {
          if (!window.confirm(copy.confirmDelete)) event.preventDefault();
        }}
      >
        <input type="hidden" name="discountId" value={discount.id} />
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          loading={deleting}
          disabled={deleting}
        >
          {copy.delete}
        </Button>
      </form>
      {error !== null && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
