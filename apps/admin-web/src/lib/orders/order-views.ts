import type { OrderView } from "@/lib/api/orders";

/** Shopify's default views, in Shopify's order (spec §1.1). */
export const ORDER_VIEWS: readonly OrderView[] = [
  "all",
  "unfulfilled",
  "unpaid",
  "open",
  "archived",
];

/** Shopify's orders page size (spec §1.5). */
export const ORDERS_PAGE_SIZE = 50;

/** `?view=` wins; Home's old `?fulfillment=unfulfilled` links read as the Unfulfilled tab; else All. */
export function parseOrderView(params: {
  readonly view?: string;
  readonly fulfillment?: string;
}): OrderView {
  const view = ORDER_VIEWS.find((candidate) => candidate === params.view);
  if (view !== undefined) return view;
  return params.fulfillment === "unfulfilled" ? "unfulfilled" : "all";
}

/** A tab's link: the search and status filter stay, the cursor does not (page 1 of the new tab). */
export function ordersViewHref(
  view: OrderView,
  keep: { readonly q?: string | undefined; readonly status?: string | undefined },
): string {
  const params = new URLSearchParams();
  if (view !== "all") params.set("view", view);
  if (keep.q !== undefined && keep.q.length > 0) params.set("q", keep.q);
  if (keep.status !== undefined && keep.status.length > 0) params.set("status", keep.status);
  const query = params.toString();
  return query.length > 0 ? `/orders?${query}` : "/orders";
}

/** A `?ids=a,b` list: trimmed, deduped, 1..max ids, else null. */
export function parseOrderIds(raw: string | undefined, max: number): readonly string[] | null {
  if (raw === undefined) return null;
  const ids = [
    ...new Set(
      raw
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  ];
  return ids.length === 0 || ids.length > max ? null : ids;
}
