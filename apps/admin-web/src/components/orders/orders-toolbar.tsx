"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Input, Label } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

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
 * Search + status filter for the Orders list — a client component because it drives the URL
 * (`?q=&status=`), which the server-rendered `OrdersPage` reads to refetch. Changing either
 * control drops `after`/`stack` (page 1 of the new filtered result) and pushes a new URL rather
 * than mutating local state, so the list, the URL, and the back button all stay in sync.
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

      <div className="flex items-center gap-2">
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
      </div>
    </div>
  );
}
