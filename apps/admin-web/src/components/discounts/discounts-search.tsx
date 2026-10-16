"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Input, Label } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

const SEARCH_DEBOUNCE_MS = 350;

/** Search by title or code — drives `?q=` (same technique as `OrdersToolbar`), back to page one. */
export function DiscountsSearch({ t }: { readonly t: Dictionary }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function onChange(next: string): void {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const q = next.trim();
      if (q === "") params.delete("q");
      else params.set("q", q);
      params.delete("after");
      params.delete("stack");
      const query = params.toString();
      router.push(query === "" ? pathname : `${pathname}?${query}`);
    }, SEARCH_DEBOUNCE_MS);
  }

  return (
    <div className="relative w-full sm:max-w-sm">
      <SearchIcon
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
      />
      <Label htmlFor="discounts-search" className="sr-only">
        {t.discounts.searchLabel}
      </Label>
      <Input
        id="discounts-search"
        type="search"
        placeholder={t.discounts.searchPlaceholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="ps-9"
      />
    </div>
  );
}
