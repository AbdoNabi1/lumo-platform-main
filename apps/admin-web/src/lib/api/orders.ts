import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/** Plan 3B: Shopify's payment status, derived on the server from the order's history (never stored). */
export type OrderPaymentStatus = "pending" | "paid" | "refunded" | "voided";

/** Plan 3B: Shopify's fulfillment status, derived on the server from the Fulfillment context. */
export type OrderFulfillmentStatus = "unfulfilled" | "in_progress" | "fulfilled" | "delivered";

/** Order operations Part 1: Shopify's default views of the list. */
export type OrderView = "all" | "unfulfilled" | "unpaid" | "open" | "archived";

export interface OrderListItemDto {
  readonly id: string;
  readonly orderNumber: string;
  readonly customerRef: string;
  readonly status: string;
  readonly currency: string;
  readonly totalMinor: number;
  readonly createdAt: string;
  /** Plan 3B: the shipping recipient's name; null when the shopper typed none. */
  readonly customerName: string | null;
  /** Plan 3B: the sum of the line quantities. */
  readonly itemCount: number;
  /** Plan 3B: the shipping method the shopper selected ("standard", …); null on older orders. */
  readonly shippingMethod: string | null;
  readonly paymentStatus: OrderPaymentStatus;
  readonly fulfillmentStatus: OrderFulfillmentStatus;
  /** Order operations Part 1: when the order was archived; null/absent when not (an older API omits it). */
  readonly archivedAt?: string | null;
  /** Order operations Part 2: the order's tags; absent from an older API. */
  readonly tags?: readonly string[];
}

export interface OrdersPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface OrdersPageDto {
  readonly items: readonly OrderListItemDto[];
  readonly pageInfo: OrdersPageInfo;
}

export type FetchOrdersResult =
  | { readonly outcome: "ok"; readonly orders: readonly OrderListItemDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

function isOrdersPageDto(value: unknown): value is OrdersPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

/** Fetches the `first` most-recently-placed orders (Dashboard's Recent Orders widget). Never throws — every failure mode is a typed outcome. */
export async function fetchRecentOrders(first: number): Promise<FetchOrdersResult> {
  const result = await getAdminApi(`/api/v1/orders?first=${first}`, isOrdersPageDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", orders: result.data.items };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

export interface OrdersListQuery {
  readonly first?: number;
  readonly after?: string;
  readonly status?: string;
  readonly search?: string;
  /** Order operations Part 1: Shopify's tab; absent or "all" sends no param. */
  readonly view?: OrderView;
}

export type FetchOrdersPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly OrderListItemDto[];
      readonly pageInfo: OrdersPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a filtered, cursor-paginated page of orders for the Orders list screen. */
export async function fetchOrdersPage(query: OrdersListQuery): Promise<FetchOrdersPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  if (query.status !== undefined) params.set("status", query.status);
  if (query.search !== undefined) params.set("search", query.search);
  if (query.view !== undefined && query.view !== "all") params.set("view", query.view);

  const result = await getAdminApi(`/api/v1/orders?${params.toString()}`, isOrdersPageDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

export interface OrderExportLineDto {
  readonly title: string;
  readonly variantTitle: string | null;
  readonly sku: string | null;
  readonly quantity: number;
}

/** One courier row per order (`GET /orders/export-rows`, spec §1.4). */
export interface OrderExportRowDto {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly createdAt: string;
  readonly customerName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly province: string | null;
  readonly country: string;
  readonly items: readonly OrderExportLineDto[];
  readonly itemCount: number;
  readonly subtotalMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly codAmountMinor: number;
  readonly currency: string;
  readonly paymentStatus: OrderPaymentStatus;
  readonly paymentProvider: string | null;
  readonly fulfillmentStatus: OrderFulfillmentStatus;
  readonly shippingMethod: string | null;
  readonly tags: readonly string[];
  readonly note: string | null;
}

export interface OrderExportQuery {
  readonly view?: OrderView | undefined;
  readonly search?: string | undefined;
  readonly status?: string | undefined;
  readonly ids?: readonly string[] | undefined;
  /** ISO instants (the route handler turns shop-local days into them). */
  readonly createdFrom?: string | undefined;
  readonly createdTo?: string | undefined;
  readonly first?: number | undefined;
  readonly after?: string | undefined;
}

export type FetchOrderExportRowsResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly OrderExportRowDto[];
      readonly pageInfo: OrdersPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

function isExportRowsPage(
  value: unknown,
): value is { items: readonly OrderExportRowDto[]; pageInfo: OrdersPageInfo } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items) &&
    typeof (value as { pageInfo?: unknown }).pageInfo === "object"
  );
}

/** One page of export rows (`orders:export`). Server-only, like every `lib/api` call. */
export async function fetchOrderExportRows(
  query: OrderExportQuery,
): Promise<FetchOrderExportRowsResult> {
  const params = new URLSearchParams();
  if (query.view !== undefined && query.view !== "all") params.set("view", query.view);
  if (query.search !== undefined) params.set("search", query.search);
  if (query.status !== undefined) params.set("status", query.status);
  if (query.ids !== undefined) params.set("ids", query.ids.join(","));
  if (query.createdFrom !== undefined) params.set("createdFrom", query.createdFrom);
  if (query.createdTo !== undefined) params.set("createdTo", query.createdTo);
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  const result = await getAdminApi(
    `/api/v1/orders/export-rows?${params.toString()}`,
    isExportRowsPage,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

export interface OrderDetailItemDto {
  readonly id: string;
  readonly productId: string;
  readonly name: string;
  /** Plan 2A: the variant sold; all null on an order placed before variants were tracked. */
  readonly variantRef: string | null;
  readonly sku: string | null;
  readonly variantTitle: string | null;
  readonly unitPriceMinor: number;
  readonly quantity: number;
  readonly lineTotalMinor: number;
  /** Plan 2C-3: the line's picture; null/absent shows the placeholder. */
  readonly imageUrl?: string | null;
}

export interface OrderAddressDto {
  readonly line1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

/** Plan 3A: an order's address as staff read it — who receives it and how to reach them; null when absent. */
export interface OrderRecipientAddressDto extends OrderAddressDto {
  readonly recipientName: string | null;
  readonly phone: string | null;
  readonly line2: string | null;
  /**
   * Plan 3C: the governorate / region / emirate (ISO 3166-2). Optional because admin-web and the API
   * deploy separately, so an older API answers without it; null/absent means none recorded.
   */
  readonly province?: string | null;
}

export interface OrderTotalsDto {
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly currency: string;
  /** Plan 3C: true when `taxMinor` is already inside the prices. Absent from an older API: the tax was added. */
  readonly taxIncluded?: boolean;
  /** Plan 3C: the shipping rate's name as the shopper saw it; null/absent on older orders. */
  readonly shippingName?: string | null;
}

export interface OrderHistoryEntryDto {
  readonly type: string;
  readonly occurredAt: string;
}

/** Order operations Part 2 — what one staff-timeline line is. */
export type OrderTimelineKind =
  | "comment"
  | "archived"
  | "unarchived"
  | "note_changed"
  | "tags_added"
  | "tags_removed"
  | "created_from_draft";

/** One line of the order's staff timeline (`GET /orders/:id` → `timelineEntries`). */
export interface TimelineEntryDto {
  readonly id: string;
  readonly kind: OrderTimelineKind;
  /** null → shown as "Staff". */
  readonly authorName: string | null;
  /** The comment text; null for activity lines and for a deleted comment. */
  readonly body: string | null;
  readonly data: {
    readonly tags?: readonly string[];
    readonly cleared?: boolean;
    readonly draftNumber?: string;
  };
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly deleted: boolean;
  /** Decided by the API: this viewer may edit / delete this line. */
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}

/** A tag suggestion (`GET /order-tags`). */
export interface OrderTagUsageDto {
  readonly tag: string;
  readonly count: number;
}

export interface OrderDetailDto {
  readonly id: string;
  readonly orderNumber: string;
  readonly customerRef: string;
  readonly status: string;
  readonly currency: string;
  readonly totalMinor: number;
  readonly createdAt: string;
  readonly items: readonly OrderDetailItemDto[];
  readonly shippingAddress: OrderRecipientAddressDto;
  readonly billingAddress: OrderRecipientAddressDto | null;
  readonly totals: OrderTotalsDto | null;
  readonly checkoutRef: string | null;
  readonly paymentRef: string | null;
  readonly fulfillmentRef: string | null;
  readonly history: readonly OrderHistoryEntryDto[];
  /** Plan 3B */
  readonly paymentStatus: OrderPaymentStatus;
  readonly fulfillmentStatus: OrderFulfillmentStatus;
  /** How the customer pays ("cod", "stripe", …), from the linked payment; null until one is linked. */
  readonly paymentProvider: string | null;
  readonly shippingMethod: string | null;
  /** G-127: whether Refund can succeed right now — decided by the backend, never guessed from the status. */
  readonly refundable: boolean;
  /** Order operations Part 1: when the order was archived; null/absent when not (an older API omits it). */
  readonly archivedAt?: string | null;
  /** Order operations Part 2 — absent from an older API. */
  readonly note?: string | null;
  readonly tags?: readonly string[];
  readonly timelineEntries?: readonly TimelineEntryDto[];
}

function isOrderDetailDto(value: unknown): value is OrderDetailDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export type FetchOrderResult =
  | { readonly outcome: "ok"; readonly order: OrderDetailDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single order for the Order Detail screen. */
export async function fetchOrder(orderId: string): Promise<FetchOrderResult> {
  const result = await getAdminApi(
    `/api/v1/orders/${encodeURIComponent(orderId)}`,
    isOrderDetailDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", order: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}

/**
 * T5.2 — the 7 order write routes below (`admin-routes.ts` lines ~1011-1117). One shared line-item
 * shape (`OrderLineItemInput`) and one shared address shape (`OrderAddressInput`) cover both
 * `placeOrder`'s and `createOrderFromCheckout`'s bodies — `placeOrderBody`/
 * `createOrderFromCheckoutBody` declare the same per-item and per-address fields verbatim, only
 * `createOrderFromCheckoutBody` additionally requires `checkoutRef`/`billingAddress` and is
 * `.strict()`. Manual unit prices ARE correct here (unlike the storefront): these are operator-
 * entered backoffice order-creation forms, not a re-derivation of a caller-untrusted price.
 */

export interface OrderLineItemInput {
  readonly productId: string;
  readonly name: string;
  readonly unitPriceAmountMinor: number;
  readonly quantity: number;
}

export interface OrderAddressInput {
  readonly line1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface PlaceOrderInput {
  readonly customerRef: string;
  readonly currency: string;
  readonly items: readonly OrderLineItemInput[];
  readonly shippingAddress: OrderAddressInput;
}

export interface CreateOrderFromCheckoutInput {
  readonly checkoutRef: string;
  readonly customerRef: string;
  readonly currency: string;
  readonly items: readonly OrderLineItemInput[];
  readonly billingAddress: OrderAddressInput;
  readonly shippingAddress: OrderAddressInput;
}

/**
 * `POST /orders` and `POST /orders/from-checkout` return the created `Order` **aggregate**, not a
 * DTO (`admin-routes.ts`'s handlers return `admin.orders.placeOrder(...)`/
 * `admin.orders.createFromCheckout(...)` directly — same situation `createProduct` in
 * `lib/api/products.ts` documents for `POST /products`). Never type the whole aggregate here: this
 * only validates the response is an object and reads an `id` off it, for the post-create redirect.
 */
function isCreatedOrder(value: unknown): value is { readonly id?: unknown } {
  return typeof value === "object" && value !== null;
}

/** Places a backoffice order (`POST /orders`, `idempotent: true`, `orders:place`). */
export async function placeOrder(
  input: PlaceOrderInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/orders",
    { method: "POST", body: input, idempotencyKey },
    isCreatedOrder,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

/**
 * Creates an order from a checkout session's order-draft snapshot (`POST /orders/from-checkout`,
 * `idempotent: true`, `orders:create_from_checkout`) — the recovery path for a checkout whose saga
 * did not auto-create its order. `totals` is re-derived server-side from Checkout, never sent here.
 */
export async function createOrderFromCheckout(
  input: CreateOrderFromCheckoutInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/orders/from-checkout",
    { method: "POST", body: input, idempotencyKey },
    isCreatedOrder,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

/**
 * The remaining 5 order write routes below follow `updateProduct`'s lead (see `lib/api/
 * products.ts`'s own T5.1 comment): none of their handlers map the response through a DTO, so
 * every one of these reads nothing off the response body — `isUnknown` only checks the call
 * succeeded. Callers `revalidatePath` the detail page afterwards, which re-fetches the real,
 * DTO-mapped state via `fetchOrder`.
 */
function isUnknown(_value: unknown): _value is unknown {
  return true;
}

function orderPath(orderId: string, suffix = ""): string {
  return `/api/v1/orders/${encodeURIComponent(orderId)}${suffix}`;
}

/** `POST /orders/:orderId/refund` (`idempotent: true`, `orders:refund`). */
export function refundOrder(
  orderId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    orderPath(orderId, "/refund"),
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

/**
 * Advances an order to an explicit, validated lifecycle status (`POST /orders/:orderId/advance`,
 * `idempotent: true`, `orders:advance`). `toStatus` must never be `"paid"`/`"payment_received"` —
 * the backend rejects those (use `markOrderPaid`); the UI gates the same way via
 * `lib/order-lifecycle.ts`'s `advanceableStatusesFrom`.
 */
export function advanceOrder(
  orderId: string,
  toStatus: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    orderPath(orderId, "/advance"),
    { method: "POST", body: { toStatus }, idempotencyKey },
    isUnknown,
  );
}

/**
 * Marks an order paid — the one authoritative payment-completion path (`POST
 * /orders/:orderId/mark-paid`, `idempotent: true`, `orders:mark_paid`).
 */
export function markOrderPaid(
  orderId: string,
  paymentRef: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    orderPath(orderId, "/mark-paid"),
    { method: "POST", body: { paymentRef }, idempotencyKey },
    isUnknown,
  );
}

/**
 * Requests payment capture via the PaymentPort (`POST /orders/:orderId/request-payment-capture`,
 * `idempotent: false`, `orders:request_payment_capture`). `mutateAdminApi` always sends the
 * `Idempotency-Key` header when a key is passed, regardless of the route's own `idempotent` flag
 * (see `lib/api/client.ts`) — the caller (`app/orders/actions.ts`) still mints exactly one key per
 * submit per this app's own rule; the backend simply won't dedupe replays by it for this route.
 */
export function requestPaymentCapture(
  orderId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    orderPath(orderId, "/request-payment-capture"),
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

/**
 * Requests fulfillment via the Inventory/Shipping ports (`POST
 * /orders/:orderId/request-fulfillment`, `idempotent: false`, `orders:request_fulfillment`). Same
 * `Idempotency-Key` note as `requestPaymentCapture` above.
 */
export function requestFulfillment(
  orderId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    orderPath(orderId, "/request-fulfillment"),
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

/** Order operations Part 1 — the list's bulk actions (`POST /orders/bulk`, one result per order). */
export const BULK_ORDER_ACTIONS = [
  "archive",
  "unarchive",
  "fulfill",
  "capture_payments",
  "mark_cod_collected",
] as const;
export type BulkOrderAction = (typeof BULK_ORDER_ACTIONS)[number];

export interface BulkOrderResultDto {
  readonly orderId: string;
  readonly outcome: "ok" | "skipped" | "failed";
  readonly reason?: string;
}

function isBulkResults(
  value: unknown,
): value is { readonly results: readonly BulkOrderResultDto[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { results?: unknown }).results)
  );
}

/** `POST /orders/bulk` (`idempotent: true`; the action's own permission is checked by the API). */
export function bulkOrders(
  action: BulkOrderAction,
  orderIds: readonly string[],
  idempotencyKey: string,
): Promise<MutationResult<{ readonly results: readonly BulkOrderResultDto[] }>> {
  return mutateAdminApi(
    "/api/v1/orders/bulk",
    { method: "POST", body: { action, orderIds }, idempotencyKey },
    isBulkResults,
  );
}

/** A printable packing slip (`GET /orders/packing-slips`). */
export interface PackingSlipDto {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly createdAt: string;
  readonly shipTo: {
    readonly name: string | null;
    readonly phone: string | null;
    readonly line1: string;
    readonly line2: string | null;
    readonly city: string;
    readonly province: string | null;
    readonly postalCode: string;
    readonly country: string;
  };
  readonly lines: readonly OrderExportLineDto[];
  readonly note: string | null;
  readonly codAmountMinor: number;
  readonly currency: string;
}

function isPackingSlips(value: unknown): value is { readonly slips: readonly PackingSlipDto[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { slips?: unknown }).slips)
  );
}

export async function fetchPackingSlips(
  ids: readonly string[],
): Promise<
  | { readonly outcome: "ok"; readonly slips: readonly PackingSlipDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string }
> {
  const result = await getAdminApi(
    `/api/v1/orders/packing-slips?ids=${ids.map(encodeURIComponent).join(",")}`,
    isPackingSlips,
  );
  if (result.outcome === "ok") return { outcome: "ok", slips: result.data.slips };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

/** `POST /orders/:orderId/archive` (`idempotent: true`, `orders:archive`). */
export function archiveOrder(
  orderId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    orderPath(orderId, "/archive"),
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

/** `POST /orders/:orderId/unarchive` (`idempotent: true`, `orders:archive`). */
export function unarchiveOrder(
  orderId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    orderPath(orderId, "/unarchive"),
    { method: "POST", idempotencyKey },
    isUnknown,
  );
}

function isNoteBody(value: unknown): value is { readonly note: string | null } {
  if (typeof value !== "object" || value === null) return false;
  const note = (value as { note?: unknown }).note;
  return note === null || typeof note === "string";
}

function isTagsBody(value: unknown): value is { readonly tags: readonly string[] } {
  return (
    typeof value === "object" && value !== null && Array.isArray((value as { tags?: unknown }).tags)
  );
}

/** `PUT /orders/:orderId/note` (`orders:edit_note`); null or blank removes the note. */
export function updateOrderNote(
  orderId: string,
  note: string | null,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly note: string | null }>> {
  return mutateAdminApi(
    orderPath(orderId, "/note"),
    { method: "PUT", body: { note }, idempotencyKey },
    isNoteBody,
  );
}

/** `POST /orders/:orderId/tags` (`orders:tag`): adds, then removes; answers the order's tags. */
export function changeOrderTags(
  orderId: string,
  change: { readonly add?: readonly string[]; readonly remove?: readonly string[] },
  idempotencyKey: string,
): Promise<MutationResult<{ readonly tags: readonly string[] }>> {
  return mutateAdminApi(
    orderPath(orderId, "/tags"),
    {
      method: "POST",
      body: {
        ...(change.add === undefined ? {} : { add: change.add }),
        ...(change.remove === undefined ? {} : { remove: change.remove }),
      },
      idempotencyKey,
    },
    isTagsBody,
  );
}

function isTagUsages(value: unknown): value is { readonly tags: readonly OrderTagUsageDto[] } {
  return isTagsBody(value);
}

/** `GET /order-tags?q=` — the shop's tags starting with `prefix`; null when the read failed. */
export async function fetchOrderTagSuggestions(
  prefix: string,
): Promise<readonly OrderTagUsageDto[] | null> {
  const result = await getAdminApi(
    `/api/v1/order-tags?q=${encodeURIComponent(prefix)}`,
    isTagUsages,
  );
  return result.outcome === "ok" ? result.data.tags : null;
}

function isTimelineEntry(value: unknown): value is TimelineEntryDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { kind?: unknown }).kind === "string"
  );
}

/** `POST /orders/:orderId/comments` (`orders:comment`); the author is the signed-in staff member. */
export function addOrderComment(
  orderId: string,
  body: string,
  idempotencyKey: string,
): Promise<MutationResult<TimelineEntryDto>> {
  return mutateAdminApi(
    orderPath(orderId, "/comments"),
    { method: "POST", body: { body }, idempotencyKey },
    isTimelineEntry,
  );
}

/** `PATCH /orders/:orderId/comments/:entryId` — the API lets only the author edit. */
export function editOrderComment(
  orderId: string,
  entryId: string,
  body: string,
  idempotencyKey: string,
): Promise<MutationResult<TimelineEntryDto>> {
  return mutateAdminApi(
    orderPath(orderId, `/comments/${encodeURIComponent(entryId)}`),
    { method: "PATCH", body: { body }, idempotencyKey },
    isTimelineEntry,
  );
}

/** `DELETE /orders/:orderId/comments/:entryId` — the author, or an admin. */
export function deleteOrderComment(
  orderId: string,
  entryId: string,
  idempotencyKey: string,
): Promise<MutationResult<TimelineEntryDto>> {
  return mutateAdminApi(
    orderPath(orderId, `/comments/${encodeURIComponent(entryId)}`),
    { method: "DELETE", idempotencyKey },
    isTimelineEntry,
  );
}
