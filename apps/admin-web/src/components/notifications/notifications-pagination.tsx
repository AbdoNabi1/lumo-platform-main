"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

/**
 * Cursor-only pagination, same client-side back-stack technique as `ReviewsPagination`/
 * `OrdersPagination`: every `pageInfo` in this app is `{ hasNextPage, endCursor }` only
 * (`packages/types/src/index.ts`'s `Paginated`), so "Previous" is a back-stack of prior cursors
 * kept in the `stack` URL param rather than a backend `before`/offset capability.
 */
export function NotificationsPagination({
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
    if (previous.length > 0) {
      params.set("stack", previous.join(","));
    } else {
      params.delete("stack");
    }
    if (target.length > 0) {
      params.set("after", target);
    } else {
      params.delete("after");
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  if (!canGoBack && !hasNextPage) {
    return null;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button variant="outline" size="sm" onClick={goPrevious} disabled={!canGoBack}>
        <ChevronLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
        {t.notificationsPage.previous}
      </Button>
      <Button variant="outline" size="sm" onClick={goNext} disabled={!hasNextPage}>
        {t.notificationsPage.next}
        <ChevronRightIcon aria-hidden="true" className="rtl:-scale-x-100" />
      </Button>
    </div>
  );
}
