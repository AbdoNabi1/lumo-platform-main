import type { OrderView } from "@/lib/api/orders";
import type { OrdersExportContext } from "@/components/orders/orders-export-dialog";

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

/** A tab's link: the search, status and tag filters stay, the cursor does not (page 1 of the new tab). */
export function ordersViewHref(
  view: OrderView,
  keep: {
    readonly q?: string | undefined;
    readonly status?: string | undefined;
    readonly tags?: readonly string[] | undefined;
  },
): string {
  const params = new URLSearchParams();
  if (view !== "all") params.set("view", view);
  if (keep.q !== undefined && keep.q.length > 0) params.set("q", keep.q);
  if (keep.status !== undefined && keep.status.length > 0) params.set("status", keep.status);
  if (keep.tags !== undefined && keep.tags.length > 0) params.set("tag", keep.tags.join(","));
  const query = params.toString();
  return query.length > 0 ? `/orders?${query}` : "/orders";
}

/**
 * What the Export button and "Export selected" carry — or `undefined` when this user may not export.
 * `orders:export` belongs to operators and admins, so a viewer (or an unrecognised role) gets no export
 * UI at all rather than a button the API would refuse. Decided on the server, from the session's role.
 */
export function ordersExportContextFor(
  role: string | undefined,
  view: OrderView,
  params: {
    readonly q?: string | undefined;
    readonly status?: string | undefined;
    readonly after?: string | undefined;
    readonly tags?: readonly string[] | undefined;
  },
): OrdersExportContext | undefined {
  if (role !== "admin" && role !== "operator") return undefined;
  return {
    view,
    ...(params.q === undefined ? {} : { q: params.q }),
    ...(params.status === undefined ? {} : { status: params.status }),
    ...(params.after === undefined ? {} : { after: params.after }),
    ...(params.tags === undefined || params.tags.length === 0 ? {} : { tags: params.tags }),
    hasFilters:
      Boolean(params.q) ||
      Boolean(params.status) ||
      (params.tags?.length ?? 0) > 0 ||
      view !== "all",
  };
}

/** Which order actions this staff member may take — so no one sees a button the API would refuse. */
export interface OrderActionPermissions {
  /** `orders:archive` (operator, admin): Archive / Unarchive, single and bulk. */
  readonly canArchive: boolean;
  /** `fulfillment:create` (operator, admin): bulk "Fulfill items". */
  readonly canFulfill: boolean;
  /** `orders:request_payment_capture` (operator, admin): bulk "Capture payments". */
  readonly canCapture: boolean;
  /** `payments:confirm_cod_collection` (admin only — money): bulk "Mark cash as received". */
  readonly canMarkCashReceived: boolean;
  /** `orders:edit_note` (operator, admin): the Notes card's pencil. */
  readonly canEditNote: boolean;
  /** `orders:tag` (operator, admin): the Tags card's input and the bulk Add / Remove tags. */
  readonly canTag: boolean;
  /** `orders:comment` (operator, admin): the timeline's comment composer. */
  readonly canComment: boolean;
}

/** A viewer's (and an unknown role's) actions: none. Print packing slips needs only `orders:read`. */
export const NO_ORDER_ACTIONS: OrderActionPermissions = {
  canArchive: false,
  canFulfill: false,
  canCapture: false,
  canMarkCashReceived: false,
  canEditNote: false,
  canTag: false,
  canComment: false,
};

/** The role table (packages/auth) for the order actions, decided on the server from the session's role. */
export function orderActionPermissionsFor(role: string | undefined): OrderActionPermissions {
  if (role !== "admin" && role !== "operator") return NO_ORDER_ACTIONS;
  return {
    canArchive: true,
    canFulfill: true,
    canCapture: true,
    canMarkCashReceived: role === "admin",
    canEditNote: true,
    canTag: true,
    canComment: true,
  };
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
