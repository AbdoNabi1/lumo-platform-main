"use client";

import { useEffect, useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import {
  changeOrderTagsAction,
  suggestOrderTagsAction,
  type TagsActionState,
} from "@/app/orders/annotation-actions";
import type { Dictionary } from "@/messages/en";
import { TagChips, TagInput } from "./tag-input";

/**
 * Shopify's Tags card (last in the order page's right column): chips with ×, an input with the shop's
 * suggestions; every change is saved immediately and the card shows the tags the API answered.
 * `canTag` (`orders:tag`) is decided on the server; a viewer sees the chips only.
 */
export function OrderTagsCard({
  orderId,
  tags,
  canTag,
  t,
}: {
  readonly orderId: string;
  readonly tags: readonly string[];
  readonly canTag: boolean;
  readonly t: Dictionary;
}) {
  const [current, setCurrent] = useState<readonly string[]>(tags);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setCurrent(tags);
  }, [tags]);

  const apply = (change: {
    readonly add?: readonly string[];
    readonly remove?: readonly string[];
  }) =>
    startTransition(async () => {
      let state: TagsActionState;
      try {
        state = await changeOrderTagsAction(orderId, change);
      } catch {
        state = { status: "error", message: t.formErrors.unexpected };
      }
      if (state.status === "saved") {
        setCurrent(state.tags);
        setError(null);
      } else {
        setError(state.message);
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.orderTags.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {canTag ? (
          <TagInput
            label={t.orderTags.inputLabel}
            tags={current}
            disabled={isPending}
            onAdd={(add) => apply({ add })}
            onRemove={(tag) => apply({ remove: [tag] })}
            suggest={suggestOrderTagsAction}
            t={t}
          />
        ) : current.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.orderTags.empty}</p>
        ) : (
          <TagChips tags={current} t={t} />
        )}
        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
