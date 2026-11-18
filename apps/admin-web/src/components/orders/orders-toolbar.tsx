"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FilterIcon, SearchIcon } from "lucide-react";
import { Input, Label } from "@platform/ui";
import { suggestOrderTagsAction } from "@/app/orders/annotation-actions";
import { MAX_TAG_FILTER, parseTagFilter } from "@/lib/orders/order-tags";
import type { Dictionary } from "@/messages/en";
import { TagInput } from "./tag-input";

const ORDER_STATUS_VALUES = [
  "placed",
  "paid",
  "refunded",
  "created",
  "confirmed",
  "cancelled",
  "held",
  "resumed",
  "awaiting_payment",
  "payment_requested",
  "payment_received",
  "payment_failed",
  "ready_for_fulfillment",
  "fulfillment_requested",
  "fulfilled",
  "partially_fulfilled",
  "delivered",
  "return_requested",
  "returned",
  "refund_requested",
  "closed",
] as const;

const SEARCH_DEBOUNCE_MS = 350;

/**
 * Search + status + "Tagged with" filter for the Orders list — a client component because it drives the
 * URL (`?q=&status=&tag=`, tags as one comma list), which the server-rendered `OrdersPage` reads to
 * refetch. Changing any control drops `after`/`stack` (page 1 of the new filtered result) and a stale
 * `exportError` and pushes a new URL rather than mutating local state, so the list, the URL, and the back button all stay in sync.
 */
export function OrdersToolbar({ t }: { readonly t: Dictionary }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setSearchValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  const pushParams = useCallback(
    (next: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value.length === 0) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      params.delete("after");
      params.delete("stack");
      // The export's error belongs to the list it was asked from, not to the new filter.
      params.delete("exportError");
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    if (debounceRef.current !== undefined) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      pushParams({ q: value.trim() });
    }, SEARCH_DEBOUNCE_MS);
  };

  const currentStatus = searchParams.get("status") ?? "";
  const currentTags = parseTagFilter(searchParams.getAll("tag"));
  const setTags = (tags: readonly string[]) => pushParams({ tag: tags.join(",") });

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1 sm:max-w-sm">
        <SearchIcon
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
        />
        <Label htmlFor="orders-search" className="sr-only">
          {t.ordersPage.searchPlaceholder}
        </Label>
        <Input
          id="orders-search"
          type="search"
          placeholder={t.ordersPage.searchPlaceholder}
          value={searchValue}
          onChange={(event) => handleSearchChange(event.target.value)}
          className="ps-9"
        />
      </div>

      <details className="relative">
        <summary className="border-input bg-card text-foreground hover:border-foreground/40 focus-visible:ring-ring inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-xl border px-3.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
          <FilterIcon aria-hidden="true" className="size-4" />
          {t.ordersPage.filter}
          {(currentStatus.length > 0 || currentTags.length > 0) && (
            <span aria-hidden="true" className="bg-primary size-2 rounded-full" />
          )}
        </summary>
        <div className="border-border bg-card absolute start-0 z-20 mt-2 flex min-w-64 flex-col gap-2 rounded-xl border p-3 shadow-lg">
          <Label htmlFor="orders-status-filter" className="text-muted-foreground text-sm">
            {t.ordersPage.statusFilterLabel}
          </Label>
          <select
            id="orders-status-filter"
            value={currentStatus}
            onChange={(event) => pushParams({ status: event.target.value })}
            className="border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-base transition-colors ease-out"
          >
            <option value="">{t.ordersPage.allStatuses}</option>
            {ORDER_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {(t.orderStatus as Record<string, string>)[status]}
              </option>
            ))}
          </select>
          <TagInput
            label={t.ordersPage.taggedWith}
            tags={currentTags}
            onAdd={(added) => setTags([...currentTags, ...added])}
            onRemove={(tag) => setTags(currentTags.filter((existing) => existing !== tag))}
            suggest={suggestOrderTagsAction}
            maxTags={MAX_TAG_FILTER}
            capHint={t.ordersPage.taggedWithLimit}
            t={t}
          />
        </div>
      </details>
    </div>
  );
}
