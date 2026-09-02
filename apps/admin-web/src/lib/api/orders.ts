import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

export interface OrderListItemDto {
  readonly id: string;
  readonly orderNumber: string;
  readonly customerRef: string;
  readonly status: string;
  readonly currency: string;
  readonly totalMinor: number;
  readonly createdAt: string;
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

export interface OrderDetailItemDto {
  readonly id: string;
  readonly productId: string;
  readonly name: string;
  readonly unitPriceMinor: number;
  readonly quantity: number;
  readonly lineTotalMinor: number;
}

export interface OrderAddressDto {
  readonly line1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface OrderTotalsDto {
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly currency: string;
}

export interface OrderHistoryEntryDto {
  readonly type: string;
  readonly occurredAt: string;
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
  readonly shippingAddress: OrderAddressDto;
  readonly billingAddress: OrderAddressDto | null;
  readonly totals: OrderTotalsDto | null;
  readonly checkoutRef: string | null;
  readonly paymentRef: string | null;
  readonly fulfillmentRef: string | null;
  readonly history: readonly OrderHistoryEntryDto[];
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
  return mutateAdminApi(orderPath(orderId, "/refund"), { method: "POST", idempotencyKey }, isUnknown);
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
