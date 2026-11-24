"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Input, Label, NativeSelect } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

const SEARCH_DEBOUNCE_MS = 350;

export interface SegmentOption {
  readonly id: string;
  readonly label: string;
}

/**
 * Search and the segment filter for the Customers list — a client component because it drives the
 * URL (`?q=&segment=`), which the server-rendered `CustomersPage` reads to refetch. Same
 * debounce/URL-sync pattern as `OrdersToolbar`, with two guarantees for the pair of filters:
 *
 *  - every write reads the CURRENT URL (a ref), never the one a timer or handler closed over, so a
 *    search that fires after a segment change cannot undo it;
 *  - choosing a segment cancels a pending search timer and writes the typed search with it, and
 *    every change (either filter) clears `after` and `stack` — a new filter starts at page 1.
 *
 * `segments` is the select's options (default segments in their localized label, then custom ones);
 * `null` hides the select (the segment list could not be loaded).
 */
export function CustomersToolbar({
  t,
  segments = null,
}: {
  readonly t: Dictionary;
  readonly segments?: readonly SegmentOption[] | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ searchParams, pathname });
  latest.current = { searchParams, pathname };

  useEffect(() => {
    setSearchValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(
    () => () => {
      if (debounceRef.current !== undefined) clearTimeout(debounceRef.current);
    },
    [],
  );

  function cancelPendingSearch(): void {
    if (debounceRef.current !== undefined) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
    }
  }

  /** Applies `next` on top of the CURRENT URL; an empty value removes the key. */
  function pushParams(next: Record<string, string | undefined>): void {
    const { searchParams: current, pathname: path } = latest.current;
    const params = new URLSearchParams(current.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value.length === 0) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    params.delete("after");
    params.delete("stack");
    const queryString = params.toString();
    router.push(queryString === "" ? path : `${path}?${queryString}`);
  }

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    cancelPendingSearch();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = undefined;
      pushParams({ q: value.trim() });
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleSegmentChange = (segment: string) => {
    cancelPendingSearch();
    // The search typed so far travels with the segment, so a pending search is not lost.
    pushParams({ segment, q: searchValue.trim() });
  };

  const currentSegment = searchParams.get("segment") ?? "";
  const options: readonly SegmentOption[] =
    segments === null
      ? []
      : currentSegment !== "" && !segments.some((segment) => segment.id === currentSegment)
        ? [...segments, { id: currentSegment, label: t.customersPage.segmentMissing }]
        : segments;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full max-w-sm">
        <SearchIcon
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
        />
        <Label htmlFor="customers-search" className="sr-only">
          {t.customersPage.searchPlaceholder}
        </Label>
        <Input
          id="customers-search"
          type="search"
          placeholder={t.customersPage.searchPlaceholder}
          value={searchValue}
          onChange={(event) => handleSearchChange(event.target.value)}
          className="ps-9"
        />
      </div>
      {segments !== null && (
        <div className="w-full max-w-60">
          <Label htmlFor="customers-segment" className="sr-only">
            {t.customersPage.segmentLabel}
          </Label>
          <NativeSelect
            id="customers-segment"
            value={currentSegment}
            onChange={(event) => handleSegmentChange(event.target.value)}
          >
            <option value="">{t.customersPage.allCustomers}</option>
            {options.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
    </div>
  );
}
