"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * Cursor-only pagination for the Files page — the algorithm of `ContentPagination`. `after` is the
 * cursor of the current page and `stack` the comma-separated cursors of the pages before it ("" is
 * page one), so Previous needs no backward repository pagination. `q`, `sort` and `view` ride along
 * untouched.
 */
export function FilesPagination({
  hasNextPage,
  endCursor,
  t,
}: {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
  readonly t: Dictionary;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentAfter = searchParams.get("after") ?? "";
  const stack = searchParams.get("stack");
  const stackEntries = stack !== null && stack.length > 0 ? stack.split(",") : [];
  const canGoBack = currentAfter.length > 0 || stackEntries.length > 0;

  const goNext = () => {
    if (endCursor === null) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("stack", [...stackEntries, currentAfter].join(","));
    params.set("after", endCursor);
    router.push(`${pathname}?${params.toString()}`);
  };

  const goPrevious = () => {
    const params = new URLSearchParams(searchParams.toString());
    const previous = [...stackEntries];
    const target = previous.pop() ?? "";
    if (previous.length > 0) params.set("stack", previous.join(","));
    else params.delete("stack");
    if (target.length > 0) params.set("after", target);
    else params.delete("after");
    const query = params.toString();
    router.push(query === "" ? pathname : `${pathname}?${query}`);
  };

  if (!canGoBack && !hasNextPage) return null;

  return (
    <nav aria-label={t.files.title} className="flex items-center justify-end gap-2">
      <Button variant="outline" size="sm" onClick={goPrevious} disabled={!canGoBack}>
        <ChevronLeftIcon aria-hidden="true" className="rtl:rotate-180" />
        {t.files.previous}
      </Button>
      <Button variant="outline" size="sm" onClick={goNext} disabled={!hasNextPage}>
        {t.files.next}
        <ChevronRightIcon aria-hidden="true" className="rtl:rotate-180" />
      </Button>
    </nav>
  );
}
