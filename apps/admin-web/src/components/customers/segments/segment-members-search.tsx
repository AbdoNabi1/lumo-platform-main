"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Input, Label } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

const SEARCH_DEBOUNCE_MS = 350;

/**
 * Search inside one segment's members, written to `?q=` (the page refetches). Every change clears
 * `after` and `stack`: a new search starts at the first page. The debounce reads the CURRENT URL
 * when it fires, never the one it was typed under.
 */
export function SegmentMembersSearch({ t }: { readonly t: Dictionary }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(searchParams);
  latest.current = searchParams;

  useEffect(() => {
    setValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(
    () => () => {
      if (debounce.current !== undefined) clearTimeout(debounce.current);
    },
    [],
  );

  function change(next: string): void {
    setValue(next);
    if (debounce.current !== undefined) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const params = new URLSearchParams(latest.current.toString());
      const query = next.trim();
      if (query === "") params.delete("q");
      else params.set("q", query);
      params.delete("after");
      params.delete("stack");
      const queryString = params.toString();
      router.push(queryString === "" ? pathname : `${pathname}?${queryString}`);
    }, SEARCH_DEBOUNCE_MS);
  }

  return (
    <div className="relative max-w-sm">
      <SearchIcon
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
      />
      <Label htmlFor="segment-members-search" className="sr-only">
        {t.segments.members.searchPlaceholder}
      </Label>
      <Input
        id="segment-members-search"
        type="search"
        placeholder={t.segments.members.searchPlaceholder}
        value={value}
        onChange={(event) => change(event.target.value)}
        className="ps-9"
      />
    </div>
  );
}
