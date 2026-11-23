"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import {
  addCollectionProductAction,
  moveCollectionProductAction,
  removeCollectionProductAction,
} from "@/app/collections/actions";
import type { CollectionMemberDto } from "@/lib/api/collections";
import type { FormState } from "@/lib/api/mutation";
import type { Dictionary } from "@/messages/en";
import { CollectionProductPicker } from "./collection-product-picker";

const INITIAL_STATE: FormState = { status: "idle" };

const STATUS_VARIANT: Readonly<
  Record<NonNullable<CollectionMemberDto["status"]>, "success" | "neutral" | "info" | "outline">
> = {
  published: "success",
  draft: "neutral",
  scheduled: "info",
  unlisted: "outline",
  archived: "outline",
};

/** One of the card's three writes, picked by the `intent` field of the form data it is given. */
async function runIntent(previous: FormState, formData: FormData): Promise<FormState> {
  switch (formData.get("intent")) {
    case "move":
      return moveCollectionProductAction(previous, formData);
    case "remove":
      return removeCollectionProductAction(previous, formData);
    default:
      return addCollectionProductAction(previous, formData);
  }
}

/**
 * The collection's products, in collection order, 50 to a page. Rows come from the members
 * endpoint (a deleted product is a `missing` row the merchant can still remove). Move up / Move
 * down use the row's GLOBAL position against the collection's COMPLETE `productIds`, so a move
 * across a page boundary works and `reorder` always receives every id; Remove is on every row.
 * One shared action state: a single busy flag keeps two writes from racing on the same order.
 */
export function CollectionProductsCard({
  collectionId,
  productIds,
  members,
  membersPage,
  hasNextPage,
  loadFailed = false,
  t,
}: {
  readonly collectionId: string;
  /** The collection's complete, ordered member ids (not just this page). */
  readonly productIds: readonly string[];
  readonly members: readonly CollectionMemberDto[];
  readonly membersPage: number;
  readonly hasNextPage: boolean;
  /** The members request failed: say so instead of an empty list. */
  readonly loadFailed?: boolean;
  readonly t: Dictionary;
}) {
  const k = t.collections.products;
  const [state, dispatch, busy] = useActionState(runIntent, INITIAL_STATE);
  const [picking, setPicking] = useState(false);
  const browseButton = useRef<HTMLButtonElement>(null);
  const statusLabels: Readonly<Record<string, string>> = t.productStatus;
  const last = productIds.length - 1;

  const submit = (intent: "add" | "move" | "remove", fields: Record<string, string>) => {
    const data = new FormData();
    data.set("intent", intent);
    data.set("collectionId", collectionId);
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    if (intent === "move") for (const id of productIds) data.append("productIds", id);
    startTransition(() => dispatch(data));
  };

  const pageHref = (page: number) =>
    `/collections/${encodeURIComponent(collectionId)}?membersPage=${page}`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{k.title}</CardTitle>
        <Button
          ref={browseButton}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPicking(true)}
        >
          {k.browse}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-0 sm:p-0">
        {state.status === "error" && (
          <p role="alert" className="text-destructive px-4 text-sm sm:px-5">
            {state.message}
          </p>
        )}
        {loadFailed ? (
          <p role="alert" className="text-destructive px-4 py-6 text-sm sm:px-5">
            {k.loadError}
          </p>
        ) : members.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-center text-sm sm:px-5">{k.empty}</p>
        ) : (
          <ul className="flex flex-col">
            {members.map((member) => {
              const name = member.missing || member.name === null ? k.deleted : member.name;
              return (
                <li
                  key={member.productId}
                  className="border-border flex items-center gap-3 border-t px-4 py-2 first:border-t-0 sm:px-5"
                >
                  <span className="text-muted-foreground w-8 text-end text-sm tabular-nums">
                    {member.position + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {member.missing ? (
                      <span className="text-muted-foreground truncate italic">{k.deleted}</span>
                    ) : (
                      <bdi dir="auto" className="truncate font-medium">
                        {name}
                      </bdi>
                    )}
                    {member.status !== null && (
                      <Badge variant={STATUS_VARIANT[member.status]}>
                        {statusLabels[member.status] ?? member.status}
                      </Badge>
                    )}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={k.moveUp.replace("{name}", () => name)}
                      disabled={busy || member.position <= 0}
                      onClick={() =>
                        submit("move", { productId: member.productId, direction: "up" })
                      }
                    >
                      <ArrowUpIcon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={k.moveDown.replace("{name}", () => name)}
                      disabled={busy || member.position >= last}
                      onClick={() =>
                        submit("move", { productId: member.productId, direction: "down" })
                      }
                    >
                      <ArrowDownIcon aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={k.remove.replace("{name}", () => name)}
                      disabled={busy}
                      onClick={() => submit("remove", { productId: member.productId })}
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {(membersPage > 1 || hasNextPage) && (
          <nav
            aria-label={k.title}
            className="border-border flex items-center justify-between gap-2 border-t px-4 py-3 sm:px-5"
          >
            <span className="text-muted-foreground text-sm">
              {k.page.replace("{n}", () => String(membersPage))}
            </span>
            <div className="flex items-center gap-2">
              {membersPage > 1 && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={pageHref(membersPage - 1)}>
                    <ChevronLeftIcon aria-hidden="true" className="rtl:rotate-180" />
                    {k.previous}
                  </Link>
                </Button>
              )}
              {hasNextPage && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={pageHref(membersPage + 1)}>
                    {k.next}
                    <ChevronRightIcon aria-hidden="true" className="rtl:rotate-180" />
                  </Link>
                </Button>
              )}
            </div>
          </nav>
        )}
      </CardContent>
      {picking && (
        <CollectionProductPicker
          excludeIds={productIds}
          onPick={(productId) => submit("add", { productId })}
          onClose={() => setPicking(false)}
          returnFocusRef={browseButton}
          t={t}
        />
      )}
    </Card>
  );
}
