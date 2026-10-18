import Link from "next/link";
import { cn } from "@platform/ui";
import type { OrderView } from "@/lib/api/orders";
import { ORDER_VIEWS, ordersViewHref } from "@/lib/orders/order-views";
import type { Dictionary } from "@/messages/en";

/** Shopify's tab strip over the list: each tab is a link (`?view=`), so every view is reachable by URL. */
export function OrdersViewTabs({
  current,
  q,
  status,
  t,
}: {
  readonly current: OrderView;
  readonly q: string | undefined;
  readonly status: string | undefined;
  readonly t: Dictionary;
}) {
  return (
    <nav
      aria-label={t.ordersPage.tabsLabel}
      className="border-border flex gap-1 overflow-x-auto border-b"
    >
      {ORDER_VIEWS.map((view) => {
        const active = view === current;
        return (
          <Link
            key={view}
            href={ordersViewHref(view, { q, status })}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2",
              active
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t.ordersPage.tabs[view]}
          </Link>
        );
      })}
    </nav>
  );
}
