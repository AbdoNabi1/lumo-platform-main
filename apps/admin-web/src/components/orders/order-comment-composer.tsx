"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Button, Label } from "@platform/ui";
import { postOrderCommentAction } from "@/app/orders/annotation-actions";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";

const INITIAL_STATE: FormState = { status: "idle" };

/**
 * Shopify's comment composer on top of the timeline: "Leave a comment..." and Post. Post is disabled
 * while empty and while posting (one submit = one idempotency key on the server, no double posts);
 * the text clears after a successful post and stays after a refusal.
 */
export function OrderCommentComposer({
  orderId,
  t,
}: {
  readonly orderId: string;
  readonly t: Dictionary;
}) {
  const c = t.orderComments;
  const id = useId();
  const [body, setBody] = useState("");
  const [state, formAction, isPending] = useActionState(postOrderCommentAction, INITIAL_STATE);
  const fieldError = state.status === "error" ? state.fieldErrors["body"] : undefined;

  useEffect(() => {
    if (state.status === "success") setBody("");
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <Label htmlFor={id} className="sr-only">
        {c.label}
      </Label>
      <textarea
        id={id}
        name="body"
        dir="auto"
        rows={2}
        value={body}
        placeholder={c.placeholder}
        onChange={(event) => setBody(event.target.value)}
        className="border-input bg-card focus-visible:ring-ring w-full rounded-xl border px-3.5 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
      />
      {state.status === "error" && (
        <p role="alert" className="text-destructive text-sm">
          {fieldError ?? state.message}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          loading={isPending}
          disabled={isPending || body.trim().length === 0}
        >
          {isPending ? c.posting : c.post}
        </Button>
      </div>
    </form>
  );
}
