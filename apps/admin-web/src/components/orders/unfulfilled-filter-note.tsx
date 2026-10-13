import Link from "next/link";
import { PackageCheckIcon, XIcon } from "lucide-react";
import type { Dictionary } from "@/messages/en";

/**
 * Shown above the orders list when it was opened from Home's "Orders to fulfill" card, so it is clear
 * why only some orders are listed, with a way back to all of them.
 */
export function UnfulfilledFilterNote({ t }: { readonly t: Dictionary }) {
  return (
    <p
      role="note"
      className="bg-warning-subtle text-warning-foreground flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-base"
    >
      <PackageCheckIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{t.ordersPage.unfulfilledFilter}</span>
      <Link
        href="/orders"
        className="focus-visible:ring-ring inline-flex items-center gap-1 rounded-md font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2"
      >
        <XIcon className="size-4" aria-hidden="true" />
        {t.ordersPage.clearFilters}
      </Link>
    </p>
  );
}
