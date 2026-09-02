const RUNTIME_API_URL = process.env.RUNTIME_API_URL ?? "http://localhost:3080";
const TENANT_ID = process.env.TENANT_DEFAULT_ID ?? "tenant-local";

export interface ProductVariantSummary {
  readonly id: string;
  readonly sku: string;
  readonly priceAmountMinor: number;
  readonly currency: string;
}

export interface ProductSummary {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly variants: readonly ProductVariantSummary[];
}

export interface CategorySummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly parentId: string | null;
}

export interface CollectionSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly productIds: readonly string[];
}

export interface PriceSummary {
  readonly id: string;
  readonly productId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly status: string;
}

export interface InventoryItemSummary {
  readonly id: string;
  readonly productId: string;
  readonly warehouseId: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
}

export interface ProductReviewSummary {
  readonly id: string;
  readonly rating: number;
  readonly bodyText: string;
  readonly assetRefs: readonly string[];
  readonly verifiedPurchase: boolean;
  readonly helpfulCount: number;
  readonly unhelpfulCount: number;
  readonly merchantResponse: string | null;
}

export interface CartItemSummary {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
  readonly currency: string;
  readonly lineTotalAmountMinor: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CartSummary {
  readonly id: string;
  readonly status: string;
  readonly currency: string;
  readonly isGuest: boolean;
  readonly items: readonly CartItemSummary[];
  readonly subtotalAmountMinor: number;
}

/**
 * Fetches a cursor-paginated PUBLIC list route from the Runtime API for the storefront's server
 * components (Phase 9 hardening). Previously this module authenticated as an admin principal —
 * minting a Hydra `client_credentials` token with `audience: "lumo-admin"` via a hardcoded dev
 * secret with no environment gate — to call the same admin-guarded routes `apps/admin` itself uses.
 * The storefront is a customer-facing surface; it has no business holding admin credentials, and a
 * hardcoded fallback secret with no gate was a real finding, not a hypothetical one. The Runtime
 * Gateway now exposes these five reads at genuinely public, unauthenticated `/public/*` paths
 * (`apps/admin/src/http/public-catalog-routes.ts`) — no token to mint, no secret to hardcode. Never
 * throws: any failure (the Runtime API down, a non-200 response) is swallowed and `null` is returned
 * so `next dev`/`next build` keep working before anyone has run the infra stack — every page
 * consuming this degrades to a friendly fallback, never a hard error.
 */
/** The routes' own cursor-pagination ceiling (`packages/repository`'s `MAX_PAGE_SIZE`). */
const MAX_PAGE_SIZE = 100;

async function fetchList<T>(
  path: string,
  params?: Readonly<Record<string, string | number>>,
): Promise<readonly T[] | null> {
  try {
    const query =
      params !== undefined
        ? `?${new URLSearchParams(
            Object.entries(params).map(([key, value]) => [key, String(value)]),
          ).toString()}`
        : "";
    const response = await fetch(`${RUNTIME_API_URL}${path}${query}`, {
      headers: { "x-tenant-id": TENANT_ID },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { items?: readonly T[] };
    return json.items ?? [];
  } catch {
    return null;
  }
}

export interface CursorPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

export interface CursorPageResult<T> {
  readonly items: readonly T[];
  readonly pageInfo: CursorPageInfo;
}

/**
 * Same fetch/parse/never-throw discipline as `fetchList`, but preserves `pageInfo` instead of
 * discarding it (T5.20) — a caller that needs to know whether more rows exist beyond this page
 * (the collection member-products page, so it can render an honest "next page" link rather than
 * silently truncating past the first page) needs the cursor, not just the items.
 */
async function fetchPage<T>(
  path: string,
  params?: Readonly<Record<string, string | number>>,
): Promise<CursorPageResult<T> | null> {
  try {
    const query =
      params !== undefined
        ? `?${new URLSearchParams(
            Object.entries(params).map(([key, value]) => [key, String(value)]),
          ).toString()}`
        : "";
    const response = await fetch(`${RUNTIME_API_URL}${path}${query}`, {
      headers: { "x-tenant-id": TENANT_ID },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      items?: readonly T[];
      pageInfo?: CursorPageInfo;
    };
    return {
      items: json.items ?? [],
      pageInfo: json.pageInfo ?? { hasNextPage: false, endCursor: null },
    };
  } catch {
    return null;
  }
}

/**
 * Fetches a single-item PUBLIC route. Unlike `fetchList` (which collapses every failure to
 * `null`), this returns the real HTTP status alongside the body — Cart's empty-state (404, no
 * cart yet) and error-state (network/5xx failure) render differently, so the caller needs to
 * tell them apart rather than have both collapse to the same "no data" signal.
 */
async function fetchItem<T>(
  path: string,
  extraHeaders?: Readonly<Record<string, string>>,
): Promise<{ readonly status: number; readonly body: T | null }> {
  try {
    const response = await fetch(`${RUNTIME_API_URL}${path}`, {
      headers: { "x-tenant-id": TENANT_ID, ...extraHeaders },
      cache: "no-store",
    });
    if (!response.ok) return { status: response.status, body: null };
    return { status: response.status, body: (await response.json()) as T };
  } catch {
    return { status: 0, body: null };
  }
}

/**
 * Posts to a PUBLIC mutation route (Phase 17.1). Unlike `fetchItem`, the body is read regardless
 * of status: a 404 (unowned/unknown cart) or 422 (validation) still carries a JSON error envelope
 * the caller may want to distinguish from a network failure — only a thrown exception (the Runtime
 * API unreachable) collapses to `status: 0, body: null`.
 */
async function postItem<T>(
  path: string,
  body: unknown,
  extraHeaders?: Readonly<Record<string, string>>,
): Promise<{ readonly status: number; readonly body: T | null }> {
  try {
    const response = await fetch(`${RUNTIME_API_URL}${path}`, {
      method: "POST",
      headers: {
        "x-tenant-id": TENANT_ID,
        "content-type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const parsed = (await response.json().catch(() => null)) as T | null;
    return { status: response.status, body: parsed };
  } catch {
    return { status: 0, body: null };
  }
}

/** Products — Catalog (`GET /public/products`, Phase 9). */
export function getProducts(
  first: number = MAX_PAGE_SIZE,
): Promise<readonly ProductSummary[] | null> {
  return fetchList<ProductSummary>("/api/v1/public/products", { first });
}

/**
 * Product search (T5.15) — `GET /public/products?query=...`. Same route and `ProductSummary` DTO
 * as `getProducts`, just with the substring `query` param `apps/admin/src/http/
 * public-catalog-routes.ts` now forwards to `ListProducts`' case-insensitive substring search
 * (`services/catalog/src/application/list-products.use-case.ts`) — a stopgap, not the Search
 * context's eventual ranked relevance (see `docs/plans/BLOCKERS.md`'s T5.15 entry).
 */
export function searchProducts(
  query: string,
  first: number = MAX_PAGE_SIZE,
): Promise<readonly ProductSummary[] | null> {
  return fetchList<ProductSummary>("/api/v1/public/products", { query, first });
}

/** One product by slug (`GET /public/products/:slug`). Replaces the list-and-filter workaround that broke past 100 products. */
export async function getProductBySlug(slug: string): Promise<ProductSummary | null> {
  const { body } = await fetchItem<ProductSummary>(
    `/api/v1/public/products/${encodeURIComponent(slug)}`,
  );
  return body;
}

/** Categories — Catalog (`GET /public/categories`, Phase 9). */
export function getCategories(): Promise<readonly CategorySummary[] | null> {
  return fetchList<CategorySummary>("/api/v1/public/categories");
}

/** Collections — Catalog (`GET /public/collections`, Phase 9). */
export function getCollections(
  first: number = MAX_PAGE_SIZE,
): Promise<readonly CollectionSummary[] | null> {
  return fetchList<CollectionSummary>("/api/v1/public/collections", { first });
}

/** One collection by slug (`GET /public/collections/:slug`). */
export async function getCollectionBySlug(slug: string): Promise<CollectionSummary | null> {
  const { body } = await fetchItem<CollectionSummary>(
    `/api/v1/public/collections/${encodeURIComponent(slug)}`,
  );
  return body;
}

/**
 * One page of a collection's member products, in the collection's own curated order
 * (`GET /public/collections/:slug/products`, T5.20). Replaces the former `getProducts()` +
 * client-side intersection workaround, which silently dropped any member beyond the catalog's
 * first 100 products. Preserves `pageInfo` (unlike most `fetchList`-backed functions here) so the
 * collection page can render an honest "next page" control instead of truncating silently.
 */
export function getCollectionProducts(
  slug: string,
  first: number = MAX_PAGE_SIZE,
  after?: string,
): Promise<CursorPageResult<ProductSummary> | null> {
  return fetchPage<ProductSummary>(
    `/api/v1/public/collections/${encodeURIComponent(slug)}/products`,
    after !== undefined ? { first, after } : { first },
  );
}

/**
 * Prices — Pricing (`GET /public/prices`, Phase 9). Despite the route's summary comment
 * ("list published prices"), `ListPrices` filters only soft-deleted rows, not `status` — this
 * can return `"draft"` prices too. Callers must filter `status === "published"` themselves;
 * see `resolvePublishedPrice` in `lib/catalog.ts`, which is the only place this should happen.
 */
export function getPrices(first: number = MAX_PAGE_SIZE): Promise<readonly PriceSummary[] | null> {
  return fetchList<PriceSummary>("/api/v1/public/prices", { first });
}

/** Stock levels — Inventory (`GET /public/inventory`, Phase 9). */
export function getInventory(
  first: number = MAX_PAGE_SIZE,
): Promise<readonly InventoryItemSummary[] | null> {
  return fetchList<InventoryItemSummary>("/api/v1/public/inventory", { first });
}

/**
 * Product reviews (T5.18, product detail page's DISPLAY-only review section) —
 * `GET /public/reviews/by-product/:productRef` (`apps/admin/src/http/public-reviews-routes.ts`).
 * Unlike `getPrices`/`getProducts`, this route already filters to `status: "published"` and the
 * `PublicReviewDto` it returns already omits `customerRef`/`status`/`productRef`/`reportCount` —
 * no further client-side trust-boundary filtering is needed here, unlike `lib/catalog.ts`'s
 * `isPublishedProduct`/`isPublishedCollection`. Writing a review is a separate, not-yet-built
 * capability gated on T5.16's customer-identity decision — no mutation function exists here.
 */
export function getProductReviews(
  productRef: string,
  first: number = MAX_PAGE_SIZE,
  after?: string,
): Promise<CursorPageResult<ProductReviewSummary> | null> {
  return fetchPage<ProductReviewSummary>(
    `/api/v1/public/reviews/by-product/${encodeURIComponent(productRef)}`,
    after !== undefined ? { first, after } : { first },
  );
}

export interface CurrentCartResponse {
  readonly cart: CartSummary | null;
}

export interface AddCartItemInput {
  readonly sessionRef: string;
  readonly productId: string;
  readonly quantity: number;
  readonly inventoryAvailable?: number;
}

/**
 * The guest Cart transport (Phase 17.1 — Guest Cart Foundation). Every call carries the caller's
 * `sessionRef` — read server-side from the storefront's own HttpOnly session cookie
 * (`apps/storefront/src/app/cart/actions.ts`), never accepted from the browser directly — which
 * the Runtime API checks against `cart.sessionRef` before any read/mutation. `POST` bodies never
 * carry a `customerRef`: these routes create and operate on guest carts only.
 *
 * `AddCartItemInput` carries no `unitPriceAmountMinor`/`currency` (H-01 remediation, Phase 17.1
 * security follow-up) — the route rejects those fields outright now; the price is always resolved
 * server-side from Pricing's published-price data, never from whatever this module sends.
 */
export function getCurrentCart(
  sessionRef: string,
): Promise<{ readonly status: number; readonly body: CurrentCartResponse | null }> {
  // H-05 (audit): sent as a header, not `?sessionRef=` — the caller's proof of cart ownership no
  // longer lands in the Runtime API's request log or any reverse-proxy access log in front of it
  // (see apps/admin/src/http/public-cart-routes.ts's own H-05 fix for the receiving side).
  return fetchItem<CurrentCartResponse>("/api/v1/public/carts/current", {
    "x-cart-session": sessionRef,
  });
}

export function createCart(
  sessionRef: string,
  currency: string,
): Promise<{ readonly status: number; readonly body: CartSummary | null }> {
  return postItem<CartSummary>("/api/v1/public/carts", { sessionRef, currency });
}

export function addCartItem(
  cartId: string,
  input: AddCartItemInput,
): Promise<{ readonly status: number; readonly body: CartSummary | null }> {
  return postItem<CartSummary>(`/api/v1/public/carts/${encodeURIComponent(cartId)}/items`, input);
}

export function changeCartItemQuantity(
  cartId: string,
  sessionRef: string,
  productId: string,
  quantity: number,
): Promise<{ readonly status: number; readonly body: CartSummary | null }> {
  return postItem<CartSummary>(
    `/api/v1/public/carts/${encodeURIComponent(cartId)}/items/quantity`,
    { sessionRef, productId, quantity },
  );
}

export function removeCartItem(
  cartId: string,
  sessionRef: string,
  productId: string,
): Promise<{ readonly status: number; readonly body: CartSummary | null }> {
  return postItem<CartSummary>(`/api/v1/public/carts/${encodeURIComponent(cartId)}/items/remove`, {
    sessionRef,
    productId,
  });
}

export function clearCart(
  cartId: string,
  sessionRef: string,
): Promise<{ readonly status: number; readonly body: CartSummary | null }> {
  return postItem<CartSummary>(`/api/v1/public/carts/${encodeURIComponent(cartId)}/clear`, {
    sessionRef,
  });
}

export interface CustomerSessionSummary {
  /** Security's opaque `Session.id`. The ONLY value the storefront stores for an identity. */
  readonly sessionId: string;
  readonly customerRef: string;
  readonly expiresAt: string;
}

export interface CustomerProfile {
  readonly customerRef: string;
  readonly email: string;
  readonly name: string;
}

/**
 * The customer authentication transport (T5.17 — `apps/admin/src/http/public-auth-routes.ts`).
 *
 * **Every function here is called only from a Server Component or Server Action.** That is the same
 * rule the cart/checkout transports above follow ("the browser only ever talks to the storefront's
 * own server"), but here it is load-bearing rather than conventional: these calls carry a password
 * or a session id, the Runtime API has no CORS configured, and the session cookie is `httpOnly`
 * precisely so browser JavaScript can never read it to send one.
 *
 * The session id travels in the `x-customer-session` HEADER, never a query string — the same H-05
 * reasoning that moved `sessionRef` out of the cart routes' query string (request logs, and any
 * reverse-proxy/CDN access log in front of the service, capture URLs verbatim). Passwords are only
 * ever POST bodies, for the same reason and more so.
 *
 * Nothing here ever sends a `customerRef`: the server derives it from the session on every request.
 * Sending one would be meaningless at best (the routes have no field for it) and an attempt to act
 * as another customer at worst.
 */
export function registerCustomer(
  email: string,
  name: string,
  password: string,
  idempotencyKey: string,
): Promise<{ readonly status: number; readonly body: { readonly customerRef: string } | null }> {
  return postItem<{ readonly customerRef: string }>(
    "/api/v1/public/auth/register",
    { email, name, password },
    { "Idempotency-Key": idempotencyKey },
  );
}

/**
 * No `Idempotency-Key`, deliberately — the route is not declared `idempotent` (replaying a cached
 * login would hand a second caller the first caller's session id; see the route's own comment).
 */
export function loginCustomer(
  email: string,
  password: string,
): Promise<{ readonly status: number; readonly body: CustomerSessionSummary | null }> {
  return postItem<CustomerSessionSummary>("/api/v1/public/auth/login", { email, password });
}

export function logoutCustomer(
  sessionId: string,
  idempotencyKey: string,
): Promise<{ readonly status: number; readonly body: { readonly revoked: boolean } | null }> {
  return postItem<{ readonly revoked: boolean }>(
    "/api/v1/public/auth/logout",
    {},
    { "x-customer-session": sessionId, "Idempotency-Key": idempotencyKey },
  );
}

/** Slides the session window forward. The session id is unchanged, so no cookie value is re-issued. */
export function refreshCustomerSession(
  sessionId: string,
): Promise<{ readonly status: number; readonly body: CustomerSessionSummary | null }> {
  return postItem<CustomerSessionSummary>(
    "/api/v1/public/auth/refresh",
    {},
    { "x-customer-session": sessionId },
  );
}

export function logoutCustomerEverywhere(
  sessionId: string,
  idempotencyKey: string,
): Promise<{ readonly status: number; readonly body: { readonly revoked: number } | null }> {
  return postItem<{ readonly revoked: number }>(
    "/api/v1/public/auth/logout-all",
    {},
    { "x-customer-session": sessionId, "Idempotency-Key": idempotencyKey },
  );
}

/** The signed-in customer's own profile — also the storefront's session-validity check (401 ⇒ signed out). */
export function getCustomerProfile(
  sessionId: string,
): Promise<{ readonly status: number; readonly body: CustomerProfile | null }> {
  return fetchItem<CustomerProfile>("/api/v1/public/auth/me", {
    "x-customer-session": sessionId,
  });
}

/** Promotes the caller's guest cart to their account on login (T5.16 §2's cart-continuity step). */
export function claimGuestCart(
  sessionId: string,
  cartId: string,
  sessionRef: string,
  idempotencyKey: string,
): Promise<{
  readonly status: number;
  readonly body: { readonly cartId: string; readonly assigned: boolean } | null;
}> {
  return postItem<{ readonly cartId: string; readonly assigned: boolean }>(
    "/api/v1/public/auth/claim-cart",
    { cartId, sessionRef },
    { "x-customer-session": sessionId, "Idempotency-Key": idempotencyKey },
  );
}

export interface WishlistItemSummary {
  readonly productRef: string;
  readonly addedAt: string;
  readonly shareToken: string | null;
}

export interface WishlistSummary {
  readonly id: string;
  readonly status: string;
  readonly items: readonly WishlistItemSummary[];
}

/**
 * The customer wishlist transport (T5.17 Part B — `apps/admin/src/http/public-wishlist-routes.ts`).
 * Same server-only rule as the auth transport above, and the same header for the session id.
 *
 * Note what no function here takes: **no `wishlistId` and no `customerRef`.** The routes address the
 * caller's own wishlist as `/me` and resolve it from the session, so there is no identifier for this
 * layer to hold, pass, or accidentally let a caller choose.
 */
export function getMyWishlist(
  sessionId: string,
): Promise<{ readonly status: number; readonly body: WishlistSummary | null }> {
  return fetchItem<WishlistSummary>("/api/v1/public/wishlists/me", {
    "x-customer-session": sessionId,
  });
}

export function addWishlistItem(
  sessionId: string,
  productRef: string,
  idempotencyKey: string,
): Promise<{ readonly status: number; readonly body: WishlistSummary | null }> {
  return postItem<WishlistSummary>(
    "/api/v1/public/wishlists/me/items",
    { productRef },
    { "x-customer-session": sessionId, "Idempotency-Key": idempotencyKey },
  );
}

export function removeWishlistItem(
  sessionId: string,
  productRef: string,
  idempotencyKey: string,
): Promise<{ readonly status: number; readonly body: WishlistSummary | null }> {
  return postItem<WishlistSummary>(
    "/api/v1/public/wishlists/me/items/remove",
    { productRef },
    { "x-customer-session": sessionId, "Idempotency-Key": idempotencyKey },
  );
}

export function shareWishlistItem(
  sessionId: string,
  productRef: string,
  idempotencyKey: string,
): Promise<{
  readonly status: number;
  readonly body: (WishlistSummary & { readonly shareToken: string }) | null;
}> {
  return postItem<WishlistSummary & { readonly shareToken: string }>(
    "/api/v1/public/wishlists/me/items/share",
    { productRef },
    { "x-customer-session": sessionId, "Idempotency-Key": idempotencyKey },
  );
}

/** `sessionRef` is the GUEST cart token — proof of cart ownership, distinct from the customer session. */
export function moveWishlistItemToCart(
  sessionId: string,
  productRef: string,
  sessionRef: string,
  idempotencyKey: string,
): Promise<{ readonly status: number; readonly body: WishlistSummary | null }> {
  return postItem<WishlistSummary>(
    "/api/v1/public/wishlists/me/items/move-to-cart",
    { productRef, sessionRef },
    { "x-customer-session": sessionId, "Idempotency-Key": idempotencyKey },
  );
}

export interface LoyaltyTransactionSummary {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly kind: string;
  readonly pointsDelta: number;
  readonly ref: string | null;
  readonly occurredAt: string;
}

export interface LoyaltyAccountSummary {
  readonly id: string;
  readonly status: string;
  readonly balance: number;
  readonly tierName: string;
  readonly transactions: readonly LoyaltyTransactionSummary[];
}

/**
 * The customer loyalty-balance transport (T5.19 — `apps/admin/src/http/public-loyalty-routes.ts`).
 * Same server-only rule and the same session header as the wishlist/auth transports above.
 *
 * Read-only, deliberately: earning, spending, cashback, redemption, and referral bonuses stay
 * admin/system-triggered — nothing a customer does directly here. A 404 means the signed-in
 * customer has no loyalty account yet (accounts are opened by an admin/system action, e.g. a first
 * purchase, never self-service) — `fetchItem` already collapses that to `{ status: 404, body: null
 * }`, which the caller must render as an honest "no account yet" state, never a fabricated
 * zero-balance account.
 */
export function getMyLoyaltyBalance(
  sessionId: string,
): Promise<{ readonly status: number; readonly body: LoyaltyAccountSummary | null }> {
  return fetchItem<LoyaltyAccountSummary>("/api/v1/public/loyalty/accounts/me", {
    "x-customer-session": sessionId,
  });
}

export interface CreateProductReviewInput {
  readonly productRef: string;
  readonly rating: number;
  readonly bodyText: string;
}

export interface ProductReviewWriteResult {
  readonly reviewId: string;
  readonly status: string;
}

/**
 * The review-authoring transport (T5.18-write — `apps/admin/src/http/public-reviews-routes.ts`).
 * Same server-only rule and the same session header as the wishlist/loyalty/auth transports
 * above. No `customerRef` field: the route derives the author from the session, exactly like
 * `addWishlistItem` derives the wishlist owner — there is nothing here for a caller to supply or
 * tamper with.
 *
 * `verifiedPurchase` is decided entirely server-side; this transport has no field to influence it
 * either way. The result is deliberately the minimal `{reviewId, status}` the backend actually
 * returns, not a fabricated full review — a fresh review is `"pending"` moderation, which the
 * caller should render as an honest "submitted, awaiting review" state, not echo back as though it
 * were already live.
 */
export function createProductReview(
  sessionId: string,
  input: CreateProductReviewInput,
  idempotencyKey: string,
): Promise<{ readonly status: number; readonly body: ProductReviewWriteResult | null }> {
  return postItem<ProductReviewWriteResult>(
    "/api/v1/public/reviews",
    input,
    { "x-customer-session": sessionId, "Idempotency-Key": idempotencyKey },
  );
}

export interface CheckoutAddressInput {
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface CheckoutSessionItemSummary {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
}

export interface CheckoutTotalsSummary {
  readonly subtotalMinor: number;
  readonly shippingMinor: number;
  readonly taxMinor: number;
  readonly grandTotalMinor: number;
}

export interface CheckoutSessionSummary {
  readonly id: string;
  readonly status: string;
  readonly currency: string;
  readonly items: readonly CheckoutSessionItemSummary[];
  readonly totals: CheckoutTotalsSummary | null;
  readonly shippingAddress: CheckoutAddressInput | null;
  readonly billingAddress: CheckoutAddressInput | null;
  readonly selectedShippingMethod: string | null;
  readonly orderRef: string | null;
}

export interface ShippingQuoteSummary {
  readonly method: string;
  readonly rateAmountMinor: number;
}

export interface PaymentIntentRequestSummary {
  readonly paymentMethodRef: string;
  readonly provider: string;
  readonly amountMinor: number;
  readonly currency: string;
}

type CheckoutResult = { readonly status: number; readonly body: CheckoutSessionSummary | null };

/**
 * The guest Checkout transport (Phase 2 — Public checkout). Same ownership model as the guest Cart
 * transport above: every call carries the caller's `sessionRef` — in the `x-cart-session` header on
 * reads, in the body on writes — which the Runtime API checks against `session.sessionRef`. No
 * function here ever sends a price, a rate, an amount, or a `customerRef` — every one of those is
 * re-derived server-side by `public-checkout-routes.ts`.
 */
export function startCheckout(
  sessionRef: string,
  cartRef: string,
  currency: string,
): Promise<CheckoutResult> {
  return postItem<CheckoutSessionSummary>("/api/v1/public/checkouts", {
    sessionRef,
    cartRef,
    currency,
  });
}

export function getCheckoutSession(
  checkoutSessionId: string,
  sessionRef: string,
): Promise<CheckoutResult> {
  return fetchItem<CheckoutSessionSummary>(
    `/api/v1/public/checkouts/${encodeURIComponent(checkoutSessionId)}`,
    { "x-cart-session": sessionRef },
  );
}

export function loadCheckoutItems(
  checkoutSessionId: string,
  sessionRef: string,
  cartId: string,
): Promise<CheckoutResult> {
  return postItem<CheckoutSessionSummary>(
    `/api/v1/public/checkouts/${encodeURIComponent(checkoutSessionId)}/items`,
    { sessionRef, cartId },
  );
}

export function setCheckoutBillingAddress(
  checkoutSessionId: string,
  sessionRef: string,
  address: CheckoutAddressInput,
): Promise<CheckoutResult> {
  return postItem<CheckoutSessionSummary>(
    `/api/v1/public/checkouts/${encodeURIComponent(checkoutSessionId)}/billing-address`,
    { sessionRef, ...address },
  );
}

export function setCheckoutShippingAddress(
  checkoutSessionId: string,
  sessionRef: string,
  address: CheckoutAddressInput,
): Promise<CheckoutResult> {
  return postItem<CheckoutSessionSummary>(
    `/api/v1/public/checkouts/${encodeURIComponent(checkoutSessionId)}/shipping-address`,
    { sessionRef, ...address },
  );
}

export function requestCheckoutShippingQuote(
  checkoutSessionId: string,
  sessionRef: string,
): Promise<{
  readonly status: number;
  readonly body: { readonly quotes: readonly ShippingQuoteSummary[] } | null;
}> {
  return postItem(
    `/api/v1/public/checkouts/${encodeURIComponent(checkoutSessionId)}/shipping-quote`,
    { sessionRef },
  );
}

export function selectCheckoutShipping(
  checkoutSessionId: string,
  sessionRef: string,
  method: string,
): Promise<CheckoutResult> {
  return postItem<CheckoutSessionSummary>(
    `/api/v1/public/checkouts/${encodeURIComponent(checkoutSessionId)}/shipping-selection`,
    { sessionRef, method },
  );
}

export function requestCheckoutTax(
  checkoutSessionId: string,
  sessionRef: string,
): Promise<{ readonly status: number; readonly body: { readonly taxMinor: number } | null }> {
  return postItem(`/api/v1/public/checkouts/${encodeURIComponent(checkoutSessionId)}/tax`, {
    sessionRef,
  });
}

export function selectCheckoutPayment(
  checkoutSessionId: string,
  sessionRef: string,
  paymentMethodRef: string,
  provider: string,
): Promise<CheckoutResult> {
  return postItem<CheckoutSessionSummary>(
    `/api/v1/public/checkouts/${encodeURIComponent(checkoutSessionId)}/payment-selection`,
    { sessionRef, paymentMethodRef, provider },
  );
}

export function recalculateCheckout(
  checkoutSessionId: string,
  sessionRef: string,
): Promise<CheckoutResult> {
  return postItem<CheckoutSessionSummary>(
    `/api/v1/public/checkouts/${encodeURIComponent(checkoutSessionId)}/recalculate`,
    { sessionRef },
  );
}

/**
 * The `Idempotency-Key` HEADER is the real replay protection (see the C-2 note on `completeBody`
 * in `apps/admin/src/http/checkout-routes.ts`) — the body's `idempotencyKey` field is sent too,
 * because the use case's contract requires it, but callers must not rely on the body field alone.
 */
export function completeCheckout(
  checkoutSessionId: string,
  sessionRef: string,
  idempotencyKey: string,
): Promise<CheckoutResult> {
  return postItem<CheckoutSessionSummary>(
    `/api/v1/public/checkouts/${encodeURIComponent(checkoutSessionId)}/complete`,
    { sessionRef, idempotencyKey },
    { "Idempotency-Key": idempotencyKey },
  );
}

export function generateCheckoutPaymentIntentRequest(
  checkoutSessionId: string,
  sessionRef: string,
): Promise<{ readonly status: number; readonly body: PaymentIntentRequestSummary | null }> {
  return fetchItem<PaymentIntentRequestSummary>(
    `/api/v1/public/checkouts/${encodeURIComponent(checkoutSessionId)}/payment-intent-request`,
    { "x-cart-session": sessionRef },
  );
}
