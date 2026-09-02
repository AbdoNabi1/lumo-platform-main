"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Input, Label } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

const SEARCH_DEBOUNCE_MS = 350;

/**
 * Search for the Customers list — a client component because it drives the URL (`?q=`), which the
 * server-rendered `CustomersPage` reads to refetch. Same debounce/URL-sync pattern as `OrdersToolbar`.
 */
export function CustomersToolbar({ t }: { readonly t: Dictionary }) {
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

  return (
    <div className="relative max-w-sm">
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
  );
}
