import Link from "next/link";
import { cn } from "@platform/ui";
import { DISCOUNT_VIEWS, type DiscountView } from "@/lib/api/discounts";
import type { Dictionary } from "@/messages/en";

/**
 * Shopify's tabs over the list — All, Active, Scheduled, Expired — as links, so the server renders
 * each view and the back button works. A tab keeps the search and starts at the first page.
 */
export function DiscountsTabs({
  view,
  q,
  t,
}: {
  readonly view: DiscountView;
  readonly q: string;
  readonly t: Dictionary;
}) {
  return (
    <nav aria-label={t.discounts.tabsLabel} className="flex gap-1 overflow-x-auto">
      {DISCOUNT_VIEWS.map((tab) => {
        const params = new URLSearchParams();
        if (tab !== "all") params.set("view", tab);
        if (q !== "") params.set("q", q);
        const query = params.toString();
        const current = tab === view;
        return (
          <Link
            key={tab}
            href={query === "" ? "/discounts" : `/discounts?${query}`}
            aria-current={current ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm",
              current ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t.discounts.tabs[tab]}
          </Link>
        );
      })}
    </nav>
  );
}
