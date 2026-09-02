"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Label } from "@platform/ui";
import type { Dictionary } from "@/messages/en";

const REVIEW_STATUS_VALUES = ["pending", "published", "rejected", "flagged", "removed"] as const;

/** The queue's own "everything, unfiltered" option — distinct from an empty string so the default (`pending`, applied by `app/reviews/page.tsx` when `status` is absent from the URL) stays selectable as an explicit choice too. */
const ALL_STATUSES_VALUE = "all";

/**
 * The moderation queue's status filter (`app/reviews/page.tsx`) — same querystring-driven pattern
 * as `OrdersToolbar`'s own status select, minus the search box (the `GET /reviews` querystring has
 * no search parameter). Changing the filter drops `after` (page 1 of the new filtered result) and
 * pushes a new URL rather than mutating local state, so the list, the URL, and the back button all
 * stay in sync.
 */
export function ReviewsToolbar({ t }: { readonly t: Dictionary }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The queue defaults to `pending` when `status` is absent from the URL at all (see
  // `app/reviews/page.tsx`), so the select must reflect that same default rather than falling back
  // to a blank "choose one" state that would misrepresent what's actually being fetched.
  const currentStatus = searchParams.get("status") ?? "pending";

  const handleChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    // `status=all` is set explicitly (never just removed) so that choosing "All statuses" is a
    // durable URL state — surviving a refresh/back-button — rather than reverting to the
    // `status`-absent URL, which `app/reviews/page.tsx` treats as the `pending` default.
    params.set("status", value);
    params.delete("after");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="reviews-status-filter" className="text-muted-foreground text-sm">
        {t.reviewsPage.statusFilterLabel}
      </Label>
      <select
        id="reviews-status-filter"
        value={currentStatus}
        onChange={(event) => handleChange(event.target.value)}
        className="border-input bg-card text-foreground hover:border-foreground/40 duration-(--duration-fast) h-9 rounded-xl border px-3.5 text-base transition-colors ease-out"
      >
        <option value={ALL_STATUSES_VALUE}>{t.reviewsPage.allStatuses}</option>
        {REVIEW_STATUS_VALUES.map((status) => (
          <option key={status} value={status}>
            {(t.reviewStatus as Record<string, string>)[status]}
          </option>
        ))}
      </select>
    </div>
  );
}
