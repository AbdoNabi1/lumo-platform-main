"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Input, Label, NativeSelect } from "@platform/ui";
import { LEAD_STATUSES } from "@/lib/leads/lead-status";
import type { Dictionary } from "@/messages/en";

const SEARCH_DEBOUNCE_MS = 350;
/** The API refuses a search longer than this with a 422. */
const SEARCH_MAX_LENGTH = 100;

/**
 * Search + status filter for the Leads list — a client component because it drives the URL
 * (`?q=&status=`), which the server-rendered `LeadsPage` reads to refetch. "All" (the default) sends
 * no `status`. Changing either control drops `after`/`stack` (page 1 of the new result) and a stale
 * `exportError`, and pushes a new URL rather than mutating local state.
 */
export function LeadsToolbar({ t }: { readonly t: Dictionary }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The status the user last chose, which may be ahead of the URL until the navigation lands: the
  // debounced search push reads it so it can never write back a stale status.
  const statusRef = useRef(searchParams.get("status") ?? "");

  useEffect(() => {
    setSearchValue(searchParams.get("q") ?? "");
    statusRef.current = searchParams.get("status") ?? "";
  }, [searchParams]);

  useEffect(
    () => () => {
      if (debounceRef.current !== undefined) clearTimeout(debounceRef.current);
    },
    [],
  );

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
      params.delete("exportError");
      const query = params.toString();
      router.push(query.length > 0 ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams],
  );

  // Always the latest push function, so a timer scheduled earlier never closes over old params.
  const pushParamsRef = useRef(pushParams);
  pushParamsRef.current = pushParams;

  const cancelPendingSearch = () => {
    if (debounceRef.current !== undefined) clearTimeout(debounceRef.current);
    debounceRef.current = undefined;
  };

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    cancelPendingSearch();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = undefined;
      pushParamsRef.current({ q: value.trim(), status: statusRef.current });
    }, SEARCH_DEBOUNCE_MS);
  };

  // A status change replaces any pending search push and sends what is typed with the new status.
  const handleStatusChange = (status: string) => {
    cancelPendingSearch();
    statusRef.current = status;
    pushParams({ q: searchValue.trim(), status });
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="relative flex-1 sm:max-w-sm">
        <SearchIcon
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute bottom-2.5 start-3 size-4"
        />
        <Label htmlFor="leads-search" className="sr-only">
          {t.leadsPage.searchLabel}
        </Label>
        <Input
          id="leads-search"
          type="search"
          maxLength={SEARCH_MAX_LENGTH}
          placeholder={t.leadsPage.searchPlaceholder}
          value={searchValue}
          onChange={(event) => handleSearchChange(event.target.value)}
          className="ps-9"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="leads-status-filter" className="text-muted-foreground text-sm">
          {t.leadsPage.statusFilterLabel}
        </Label>
        <NativeSelect
          id="leads-status-filter"
          value={searchParams.get("status") ?? ""}
          onChange={(event) => handleStatusChange(event.target.value)}
          className="sm:w-48"
        >
          <option value="">{t.leadsPage.allStatuses}</option>
          {LEAD_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t.leadStatus[status]}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}
