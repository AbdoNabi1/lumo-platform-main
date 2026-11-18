import Link from "next/link";
import { cn } from "@platform/ui";
import type { DraftOrderStatus } from "@/lib/api/draft-orders";
import { DRAFT_STATUSES, draftsHref } from "@/lib/orders/draft-orders";
import type { Dictionary } from "@/messages/en";

/** Shopify's Drafts tabs: All, Open, Invoice sent, Completed — each a link (`?status=`). */
export function DraftOrdersTabs({
  current,
  q,
  t,
}: {
  readonly current: DraftOrderStatus | undefined;
  readonly q: string | undefined;
  readonly t: Dictionary;
}) {
  const tabs: readonly (DraftOrderStatus | undefined)[] = [undefined, ...DRAFT_STATUSES];
  return (
    <nav
      aria-label={t.draftOrders.tabsLabel}
      className="border-border flex gap-1 overflow-x-auto border-b"
    >
      {tabs.map((status) => {
        const active = status === current;
        return (
          <Link
            key={status ?? "all"}
            href={draftsHref({ status, q })}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2",
              active
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t.draftOrders.tabs[status ?? "all"]}
          </Link>
        );
      })}
    </nav>
  );
}
