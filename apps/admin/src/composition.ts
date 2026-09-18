import { wireAnalytics } from "@platform/analytics";
import { wireAutomation } from "@platform/automation";
import { wireCart, type CartController } from "@platform/cart";
import {
  wireCatalog,
  type CategoryController,
  type CollectionController,
  type ProductController,
} from "@platform/catalog";
import {
  wireCheckout,
  type CheckoutController,
  type InventoryValidationPort,
  type OrderCreationPort,
  type PricingValidationPort,
  type PromotionValidationPort,
  type ShippingCalculationPort,
  type TaxCalculationPort,
} from "@platform/checkout";
import { wireComponents } from "@platform/components";
import { wireContent } from "@platform/content";
import type {
  AccessControl,
  AuditTrail,
  Clock,
  IdGenerator,
  PaymentProvider,
} from "@platform/contracts";
import { wireCoupons } from "@platform/coupons";
import { wireCustomer360 } from "@platform/customer-360";
import type { Database } from "@platform/db";
import type { EventSerializer } from "@platform/domain-events";
import { wireExperience } from "@platform/experience";
import { wireExperimentation } from "@platform/experimentation";
import { wireFeatureFlags } from "@platform/feature-flags-service";
import { wireFeatureRegistry } from "@platform/feature-registry";
import { wireFinance } from "@platform/finance";
import type { PostingAccounts } from "@platform/finance";
import { wireFulfillment } from "@platform/fulfillment";
import { wireIdentity, type CustomerController } from "@platform/identity";
import { wireInventory, type InventoryController } from "@platform/inventory";
import { wireLicensing, type FinanceLedgerPort, type PaymentsPort } from "@platform/licensing";
import { wireLocalization } from "@platform/localization";
import { wireLoyalty, type LoyaltyController } from "@platform/loyalty";
import { wireMediaLibrary, type ObjectStoragePort } from "@platform/media";
import { wireNotifications } from "@platform/notifications";
import {
  wireOrders,
  type InventoryPort as OrdersInventoryPort,
  type NotificationPort as OrdersNotificationPort,
  type OrderController,
  type PaymentPort as OrdersPaymentPort,
  type PaymentVerificationPort,
  type ShippingPort as OrdersShippingPort,
} from "@platform/orders";
import { wirePages } from "@platform/pages";
import {
  wirePayments,
  type FinancePort as PaymentsFinancePort,
  type NotificationPort as PaymentsNotificationPort,
  type OrdersPort as PaymentsOrdersPort,
  type PaymentController,
} from "@platform/payments";
import { wirePlatformConsole } from "@platform/platform-console";
import { wirePricing, type PriceController } from "@platform/pricing";
import { wirePromotions } from "@platform/promotions";
import { wireRecommendations } from "@platform/recommendations";
import { wireReporting } from "@platform/reporting";
import {
  wireReturns,
  type PaymentsPort as ReturnsPaymentsPort,
  type RefundVerificationPort,
} from "@platform/returns";
import { wireReviews, type ReviewsController } from "@platform/reviews";
import { wireSearch } from "@platform/search";
import {
  wireSecurity,
  type MfaProviderResolver,
  type SecurityController,
} from "@platform/security";
import { wireSeo } from "@platform/seo";
import { wireShipping } from "@platform/shipping";
import { wireTenancy } from "@platform/tenancy";
import { wireTheme } from "@platform/theme";
import { wireWishlist, type WishlistController } from "@platform/wishlist";
import { AllowAllAccessControl } from "./infrastructure/allow-all-access-control";
import { InventoryValidationAdapter } from "./infrastructure/cross-context/inventory-validation.adapter";
import { OrdersInventoryAdapter } from "./infrastructure/cross-context/orders-inventory.adapter";
import { OrderCreationAdapter } from "./infrastructure/cross-context/order-creation.adapter";
import { OrdersNotificationAdapter } from "./infrastructure/cross-context/orders-notification.adapter";
import { OrdersPaymentAdapter } from "./infrastructure/cross-context/orders-payment.adapter";
import { PaymentsNotificationAdapter } from "./infrastructure/cross-context/payments-notification.adapter";
import { PaymentsOrdersAdapter } from "./infrastructure/cross-context/payments-orders.adapter";
import { PricingValidationAdapter } from "./infrastructure/cross-context/pricing-validation.adapter";
import { PromotionValidationAdapter } from "./infrastructure/cross-context/promotion-validation.adapter";
import { InMemoryAuditTrail } from "./infrastructure/in-memory-audit-trail";
import { AccessAdminController } from "./interfaces/access.admin-controller";
import { AdminGuard } from "./interfaces/admin-guard";
import { CustomerAuthAdminController } from "./interfaces/customer-auth.admin-controller";
import type { CustomerCredentialsPort } from "./interfaces/customer-credentials.port";
import { CustomerGuard } from "./interfaces/customer-guard";
import { AnalyticsAdminController } from "./interfaces/analytics.admin-controller";
import { AutomationAdminController } from "./interfaces/automation.admin-controller";
import { CartAdminController } from "./interfaces/cart.admin-controller";
import { CheckoutAdminController } from "./interfaces/checkout.admin-controller";
import { ComponentsAdminController } from "./interfaces/components.admin-controller";
import { ContentAdminController } from "./interfaces/content.admin-controller";
import { CouponsAdminController } from "./interfaces/coupons.admin-controller";
import { Customer360AdminController } from "./interfaces/customer-360.admin-controller";
import { CustomersAdminController } from "./interfaces/customers.admin-controller";
import { ExperienceAdminController } from "./interfaces/experience.admin-controller";
import { ExperimentationAdminController } from "./interfaces/experimentation.admin-controller";
import { FeatureFlagsAdminController } from "./interfaces/feature-flags.admin-controller";
import { FeatureRegistryAdminController } from "./interfaces/feature-registry.admin-controller";
import { FinanceAdminController } from "./interfaces/finance.admin-controller";
import { FulfillmentAdminController } from "./interfaces/fulfillment.admin-controller";
import { InventoryAdminController } from "./interfaces/inventory.admin-controller";
import { LicensingAdminController } from "./interfaces/licensing.admin-controller";
import { LocalizationAdminController } from "./interfaces/localization.admin-controller";
import { LoyaltyAdminController } from "./interfaces/loyalty.admin-controller";
import { MediaLibraryAdminController } from "./interfaces/media-library.admin-controller";
import { NotificationsAdminController } from "./interfaces/notifications.admin-controller";
import { OrdersAdminController } from "./interfaces/orders.admin-controller";
import { PagesAdminController } from "./interfaces/pages.admin-controller";
import { PaymentsAdminController } from "./interfaces/payments.admin-controller";
import { PlatformConsoleAdminController } from "./interfaces/platform-console.admin-controller";
import { PricingAdminController } from "./interfaces/pricing.admin-controller";
import { ProductsAdminController } from "./interfaces/products.admin-controller";
import { PromotionsAdminController } from "./interfaces/promotions.admin-controller";
import { RecommendationsAdminController } from "./interfaces/recommendations.admin-controller";
import { ReportingAdminController } from "./interfaces/reporting.admin-controller";
import { ReturnsAdminController } from "./interfaces/returns.admin-controller";
import { ReviewsAdminController } from "./interfaces/reviews.admin-controller";
import { SearchAdminController } from "./interfaces/search.admin-controller";
import { SecurityAiGovernanceAdminController } from "./interfaces/security-ai-governance.admin-controller";
import { SecurityAuthorizationAdminController } from "./interfaces/security-authorization.admin-controller";
import { SecurityIdentityAdminController } from "./interfaces/security-identity.admin-controller";
import { SecurityOperationsAdminController } from "./interfaces/security-operations.admin-controller";
import { SecuritySecretsAdminController } from "./interfaces/security-secrets.admin-controller";
import { SecuritySessionsAdminController } from "./interfaces/security-sessions.admin-controller";
import { SeoAdminController } from "./interfaces/seo.admin-controller";
import { ShippingAdminController } from "./interfaces/shipping.admin-controller";
import { TenancyAdminController } from "./interfaces/tenancy.admin-controller";
import { ThemeAdminController } from "./interfaces/theme.admin-controller";
import { WishlistAdminController } from "./interfaces/wishlist.admin-controller";

/**
 * Chart-of-accounts references Finance's `LedgerPoster` posts commerce events to (Sprint 3.1).
 * Not named by any primary source at file-level — a documented composition-time default, held
 * here rather than invented inside the Finance package itself.
 */
const DEFAULT_FINANCE_POSTING_ACCOUNTS: PostingAccounts = {
  revenue: "4000-REVENUE",
  receivable: "1200-ACCOUNTS-RECEIVABLE",
  cogs: "5000-COGS",
  inventory: "1300-INVENTORY",
  refundContra: "4900-REFUNDS",
  expense: "6000-EXPENSES",
  cash: "1000-CASH",
  fees: "6100-FEES",
};

export interface AdminWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * RBAC decision point for every admin action (ADR-0007). Defaults to the permissive
   * `AllowAllAccessControl` until the real provider (Ory/Keto, Phase 2) is wired — swapping it is
   * a composition change only; controller signatures stay frozen.
   */
  readonly accessControl?: AccessControl;
  /**
   * Immutable audit sink for every authorization decision (ADR-0009). Defaults to the in-memory
   * trail; the production adapter appends `audit.entry.recorded` through the outbox.
   */
  readonly auditTrail?: AuditTrail;
  /**
   * Production persistence (G-39). Present ⇒ every wired context that supports a Prisma slice
   * (today: Finance, Feature Registry, Security, Customer 360 — each via their own `prisma?`/
   * `tenantId?`-presence composition branch) receives it, since `deps` is passed straight through
   * to every `wireX(deps)` call below; absent ⇒ every context stays in-memory, unchanged from
   * before this field existed. The other 35 wired contexts have no Prisma composition branch of
   * their own yet and are unaffected either way — this does not add one for them.
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) by every context that reads it. */
  readonly tenantId?: string;
  /**
   * Gates Orders' admin backoffice `markOrderPaid` action against Payments (Sprint A1 Task 5).
   * Passed straight through to `wireOrders(deps)` below; defaults to Orders' own always-verify
   * in-memory stub when absent — no behavior change for existing callers/tests.
   */
  readonly paymentVerification?: PaymentVerificationPort;
  /**
   * Gates Returns' `DecideResolution` staff-decided refund amount against the order's refundable
   * ceiling (Phase A.1, F-04). Passed straight through to `wireReturns(deps)` below; defaults to
   * Returns' own always-verify in-memory stub when absent — no behavior change for existing
   * callers/tests.
   */
  readonly refundVerification?: RefundVerificationPort;
  /**
   * Executes an approved Returns refund against Payments (Phase A.3). Passed straight through to
   * `wireReturns(deps)` below; defaults to Returns' own offline no-op stub when absent — no
   * behavior change for existing callers/tests. Named distinctly from `payments` below (Licensing's
   * unrelated, differently-shaped billing-collection port of the same name).
   */
  readonly paymentsPort?: ReturnsPaymentsPort;
  /**
   * Production MFA provider resolver (C2-4). Passed straight through to `wireSecurity(deps)` below;
   * absent ⇒ Security's own in-memory reference TOTP stub (hardcoded validCode), same as before this
   * field existed. `apps/runtime/src/api.ts` refuses to boot outside `local` without a real one.
   */
  readonly mfaProviders?: MfaProviderResolver;
  /**
   * Production PSP-backed billing collection for Licensing (M2-3). Passed straight through to
   * `wireLicensing(deps)` below; absent ⇒ Licensing's own always-succeeds in-memory stub, same as
   * before this field existed. `apps/runtime/src/api.ts` refuses to boot outside `local` without a
   * real one.
   */
  readonly payments?: PaymentsPort;
  /**
   * Production Finance-ledger settlement posting for Licensing (M2-3). Passed straight through to
   * `wireLicensing(deps)` below; absent ⇒ Licensing's own no-op in-memory stub. Same boot guard as
   * `payments` above.
   */
  readonly financeLedger?: FinanceLedgerPort;
  /**
   * Production object-storage adapter for the Media Library (M2-2). Passed straight through to
   * `wireMediaLibrary(deps)` below; absent ⇒ Media's own `InMemoryObjectStorage` (`exists()` always
   * `true`, `getDownloadUrl()` a URL template that never points at real storage), same as before
   * this field existed. `apps/runtime/src/api.ts` refuses to boot outside `local` while the
   * resolved adapter is still that in-memory stub.
   */
  readonly objectStorage?: ObjectStoragePort;
  /**
   * Production PSP adapter for Payments (C2-2). Passed straight through to `wirePayments(deps)`
   * below; absent ⇒ Payments' own `InMemoryPaymentProvider` (`verifyWebhook()` always `true`, every
   * money operation a no-op), same as before this field existed. `apps/runtime/src/api.ts` refuses
   * to boot outside `local` without a real one.
   */
  readonly paymentProvider?: PaymentProvider;
  /**
   * Stage 5 (audit remediation, C-03 partial): the 4 outbound ports Orders' `RequestPaymentCapture`/
   * `RequestFulfillment` use-cases call. Passed straight through to `wireOrders(deps)` below;
   * absent ⇒ Orders' own offline in-memory stubs, no behavior change for existing callers/tests.
   * `apps/runtime/src/api.ts` refuses to boot outside `local` while any integration port below is
   * still unresolved.
   */
  readonly paymentPort?: OrdersPaymentPort;
  readonly inventoryPort?: OrdersInventoryPort;
  readonly shippingPort?: OrdersShippingPort;
  readonly notifications?: OrdersNotificationPort;
  /**
   * Stage 5 (audit remediation, C-03 partial): the 5 orchestration ports Checkout's
   * `ValidateCheckout`/`RequestTaxCalculation`/`RequestShippingQuote`/`ValidatePromotion`/
   * `SelectShipping` use-cases call. Passed straight through to `wireCheckout(deps)` below; absent
   * ⇒ Checkout's own offline in-memory stubs, no behavior change for existing callers/tests.
   */
  readonly pricingValidation?: PricingValidationPort;
  readonly inventoryValidation?: InventoryValidationPort;
  readonly taxCalculation?: TaxCalculationPort;
  readonly shippingCalculation?: ShippingCalculationPort;
  readonly promotionValidation?: PromotionValidationPort;
  /**
   * C-2: the outbound seam `CompleteCheckout` uses to materialize an order from a completed
   * session. Passed straight through to `wireCheckout(deps)` below; absent ⇒ Checkout's own
   * `InMemoryOrderCreationAdapter` (fabricates a deterministic `orderRef`, never persists
   * anything). The real adapter over Orders' `CreateOrderFromCheckout` is a separate task — this
   * field exists so tests (and, later, that adapter) can override the fallback the same way the
   * 5 orchestration ports above do.
   */
  readonly orderCreation?: OrderCreationPort;
  /**
   * Stage 5 (audit remediation, C-03 partial): the 3 outbound reference-only ports Payments'
   * lifecycle use-cases call. Passed straight through to `wirePayments(deps)` below; absent ⇒
   * Payments' own offline in-memory stubs, no behavior change for existing callers/tests. Named
   * `paymentsNotifications` (not `notifications`) — Orders' `notifications` above is a structurally
   * different `NotificationPort`, and this single `deps` object is threaded into both `wireOrders`
   * and `wirePayments` unchanged, so the two fields cannot share a name and type.
   */
  readonly ordersPort?: PaymentsOrdersPort;
  readonly financePort?: PaymentsFinancePort;
  readonly paymentsNotifications?: PaymentsNotificationPort;
}

export interface WiredAdmin {
  /** Products screen → Catalog. */
  readonly products: ProductsAdminController;
  /** Inventory screen → Inventory. */
  readonly inventory: InventoryAdminController;
  /** Orders screen → Orders. */
  readonly orders: OrdersAdminController;
  /** Customers screen → Identity. */
  readonly customers: CustomersAdminController;
  /**
   * Customer 360 screen → Customer-360's read side (Sprint S1 — Customer-360's first
   * admin-transport wiring). Read-only, no outbox exposed beyond a no-op drain (in-memory slice
   * only, same as `wireIdentity`/`wireFinance` — the Prisma slice is drained by CDC) — same reason
   * `analytics`/`platformConsole` below are excluded from the `contexts` drain array.
   */
  readonly customer360: Customer360AdminController;
  /** Users/Organizations/Memberships screens → Identity's Access slice (Sprint 4.1). */
  readonly access: AccessAdminController;
  /** Automation screen → Automation (Sprint S1 — Automation's first admin-transport wiring). */
  readonly automation: AutomationAdminController;
  /**
   * Analytics screen → Analytics' semantic-layer catalog (Sprint S1 — Analytics' first
   * admin-transport wiring). Read-only, no outbox — same minimal shape as `platformConsole` below,
   * so it is intentionally excluded from the `contexts` drain array.
   */
  readonly analytics: AnalyticsAdminController;
  /** Discounts + Coupons screens → Pricing. */
  readonly pricing: PricingAdminController;
  /** Cart screen → Cart (Sprint 4.5 — Cart's first admin-transport wiring). */
  readonly cart: CartAdminController;
  /** Checkout screen → Checkout (Sprint 4.6 — Checkout's first admin-transport wiring). */
  readonly checkout: CheckoutAdminController;
  /** Payments screen → Payments (Sprint 4.8 — Payments' first admin-transport wiring). */
  readonly payments: PaymentsAdminController;
  /** Fulfillment screen → Fulfillment (Sprint 4.9 — Fulfillment's first admin-transport wiring). */
  readonly fulfillment: FulfillmentAdminController;
  /** Shipping screen → Shipping (Sprint 4.10 — Shipping's first admin-transport wiring). */
  readonly shipping: ShippingAdminController;
  /** Returns screen → Returns (Sprint 4.11 — Returns' first admin-transport wiring). */
  readonly returns: ReturnsAdminController;
  /** Reviews screen → Reviews (Sprint S1 — Reviews' first admin-transport wiring). */
  readonly reviews: ReviewsAdminController;
  /** Search screen → Search (Sprint S1 — Search's first admin-transport wiring). */
  readonly search: SearchAdminController;
  /**
   * Security screen (Identity & Credentials slice) → Security (Sprint S1.5.1 — Security's first
   * admin-transport wiring). Security's ~80-method controller is split across multiple
   * `Security*AdminController` slices, each its own S1.5.x sub-milestone, all sharing the single
   * `wireSecurity()` composition below.
   */
  readonly securityIdentity: SecurityIdentityAdminController;
  /** Security screen (Sessions & Authentication slice) → Security (Sprint S1.5.2). */
  readonly securitySessions: SecuritySessionsAdminController;
  /** Security screen (Authorization slice) → Security (Sprint S1.5.3). */
  readonly securityAuthorization: SecurityAuthorizationAdminController;
  /** Security screen (Secrets slice) → Security (Sprint S1.5.4). */
  readonly securitySecrets: SecuritySecretsAdminController;
  /** Security screen (Security Operations slice) → Security (Sprint S1.5.5). */
  readonly securityOperations: SecurityOperationsAdminController;
  /** Security screen (AI Governance slice) → Security (Sprint S1.5.6, last of the six sub-milestones). */
  readonly securityAiGovernance: SecurityAiGovernanceAdminController;
  /** Notifications screen → Notifications (Sprint 4.12 — Notifications' first admin-transport wiring). */
  readonly notifications: NotificationsAdminController;
  /** Finance screen → Finance (ADR-0024). */
  readonly finance: FinanceAdminController;
  /** Content Blocks screen → Content (Sprint 5.4 — Content's first admin-transport wiring). */
  readonly content: ContentAdminController;
  /** Coupons screen → Coupons (Sprint S1 — Coupons' first admin-transport wiring). */
  readonly coupons: CouponsAdminController;
  /** Experiments screen → Experimentation (Sprint S1 — Experimentation's first admin-transport wiring). */
  readonly experimentation: ExperimentationAdminController;
  /** Feature Flags screen → Feature Flags (Sprint S1 — Feature Flags' first admin-transport wiring). */
  readonly featureFlags: FeatureFlagsAdminController;
  /** Feature Registry screen → Feature Registry (Sprint S1 — Feature Registry's first admin-transport wiring). */
  readonly featureRegistry: FeatureRegistryAdminController;
  /** Promotions screen → Promotions (Sprint S1 — Promotions' first admin-transport wiring). */
  readonly promotions: PromotionsAdminController;
  /** Recommendations screen → Recommendations (Sprint S1 — Recommendations' first admin-transport wiring). */
  readonly recommendations: RecommendationsAdminController;
  /** Reporting screen → Reporting (Sprint S1 — Reporting's first admin-transport wiring). */
  readonly reporting: ReportingAdminController;
  /** Localization screen → Localization (Sprint 5.4 — Localization's first admin-transport wiring). */
  readonly localization: LocalizationAdminController;
  /** Loyalty screen → Loyalty (Sprint S1 — Loyalty's first admin-transport wiring). */
  readonly loyalty: LoyaltyAdminController;
  /** SEO screen → SEO (Sprint 5.4 — SEO's first admin-transport wiring). */
  readonly seo: SeoAdminController;
  /** Component Library screen → Components (Sprint 5.4 — Components' first admin-transport wiring). */
  readonly components: ComponentsAdminController;
  /** Theme System screen → Theme (Sprint 5.4 — Theme's first admin-transport wiring). */
  readonly theme: ThemeAdminController;
  /** Experience Builder screen → Experience (Sprint 5.4 — Experience's first admin-transport wiring). */
  readonly experience: ExperienceAdminController;
  /** Dynamic Pages screen → Pages (Sprint 5.4 — Pages' first admin-transport wiring). */
  readonly pages: PagesAdminController;
  /** Media Library screen → Media Library extension (Sprint 5.4 — Media's first admin-transport wiring). */
  readonly mediaLibrary: MediaLibraryAdminController;
  /** Tenancy screen → Tenancy (Sprint 5.5/5.6 — Tenancy's first admin-transport wiring). */
  readonly tenancy: TenancyAdminController;
  /** Licensing screen → Licensing (Sprint 5.5/5.6 — Licensing's first admin-transport wiring). */
  readonly licensing: LicensingAdminController;
  /** Platform Console screen → Platform Console (Sprint 5.6, ADR-0018 addendum-2 §J — read-model only). */
  readonly platformConsole: PlatformConsoleAdminController;
  /** Wishlist screen → Wishlist (Sprint S1 — Wishlist's first admin-transport wiring). */
  readonly wishlist: WishlistAdminController;
  /**
   * The storefront's customer authentication surface (T5.17) → Security + Identity. Deliberately
   * NOT a `*AdminController`: it is gated by {@link CustomerGuard} (valid customer session) rather
   * than `AdminGuard` (staff principal + ABAC permission), and it is the only place a `customerRef`
   * is derived for a public route. `public-auth-routes.ts` is its transport; T5.19/T5.18-write reuse
   * its `requireSession` seam rather than building a second one.
   */
  readonly customerAuth: CustomerAuthAdminController;
  /** Drains every wired context's outbox once; returns the total number of events published. */
  readonly drainOutbox: () => Promise<number>;
  /** Integration-event types delivered so far across all wired contexts (for demonstration/tests). */
  readonly deliveredEventTypes: readonly string[];
  /**
   * The read-only framework-agnostic controllers backing the explicitly-public storefront routes
   * (Sprint 9 hardening, A1g) — the SAME controllers `products`/`pricing`/`inventory` above wrap,
   * exposed here WITHOUT a guard. A public route's authorization is "this route is declared public
   * in code" (reviewed once, here), not an RBAC decision against a fabricated anonymous principal —
   * the latter would either silently over-grant under `AllowAllAccessControl` or silently 403 under
   * Keto (no policy ever grants a "public" principal anything), neither of which is what "public"
   * means. No new read logic, no new persistence — reuses `catalog`/`pricing`/`inventory`'s existing
   * `list()` use cases verbatim.
   *
   * `collections` was previously excluded here on the grounds that Sprint 7.0 §13 deferred
   * Collection's *admin* surface. That reasoning does not transfer: this is the public read surface,
   * `ListCollections` + `CollectionController.list` already exist and are already wired into
   * `wireCatalog`, and the storefront has been calling `/api/v1/public/collections` since Phase 8.1
   * against a route that never existed. Exposing the read here adds no admin surface and does not
   * un-defer Sprint 7.0 §13 — Collection still has no guarded write route anywhere.
   */
  readonly publicReads: {
    readonly products: ProductController;
    readonly categories: CategoryController;
    readonly collections: CollectionController;
    readonly prices: PriceController;
    readonly inventory: InventoryController;
    /**
     * Cart's read (`get`) is public the same way Products/Categories/Collections/Prices/Inventory
     * are — a shopper's own cart page has no admin credentials to present. The full
     * `CartController` is reused verbatim (same convention as the others above, e.g. `products:
     * catalog.products`): only `GET /public/carts/:cartId` (`public-cart-routes.ts`) actually calls
     * into it, and that route calls `.get()` exclusively — it does not expose `create`/`add`/etc.
     */
    readonly cart: CartController;
    /**
     * Checkout's guest surface. Same reasoning as `cart` above: a shopper completing checkout has
     * no admin credentials, so the raw `CheckoutController` is exposed here and
     * `public-checkout-routes.ts` enforces ownership itself via `sessionRef` before every call.
     * The guarded `CheckoutAdminController` remains the only path for the authenticated
     * back-office surface (`checkout-routes.ts`).
     *
     * This property lives on `publicReads` even though checkout writes. Keep it here rather than
     * inventing a `publicWrites` — `publicReads.cart` already holds a controller whose write
     * methods are used by `public-cart-routes.ts`, and one seam is easier to audit than two.
     */
    readonly checkout: CheckoutController;
    /**
     * Reviews' guest read surface (T5.18 — product review display). Same reasoning as `cart`/
     * `checkout` above: every route in `reviews-routes.ts` goes through the guarded
     * `ReviewsAdminController`, which requires a `Principal` — a storefront shopper has none. The
     * raw, unguarded `ReviewsController` is exposed here instead, and `public-reviews-routes.ts`
     * calls only `.listByProduct()`, filtering to `status: "published"` itself before mapping to
     * `PublicReviewDto` (that DTO omits `customerRef`/`status`/`productRef`/`reportCount` —
     * privacy/moderation fields that must never reach an anonymous caller).
     */
    readonly reviews: ReviewsController;
    /**
     * Security's raw controller (T5.17). Same reasoning as `cart`/`checkout`/`reviews` above, with
     * one addition specific to this context: every route in `security-sessions-routes.ts` requires a
     * staff `Principal` holding `security:authenticate`/`security:establish_session`/etc., and a
     * shopper logging in has neither — nor should logging in as a customer ever require an *admin*
     * permission grant. Only `CustomerAuthAdminController` calls into this, and only the
     * session/authentication slice of it (`authenticate`, `introspectSessionSubject`,
     * `refreshSession`, `revokeSession`, `revokeAllSessions`, `registerPrincipal`); the guarded
     * `Security*AdminController`s remain the only path to the operator console's surface.
     */
    readonly security: SecurityController;
    /**
     * Identity's raw `CustomerController` (T5.17) — registration (`/public/auth/register`) and the
     * session → principal → customer resolution `CustomerGuard` performs on every request. The
     * guarded `CustomersAdminController` (`customers:read`/`customers:register`) stays the only path
     * for the back-office Customers screen.
     */
    readonly customers: CustomerController;
    /**
     * Wishlist's customer-facing surface (T5.17 Part B). Same reasoning as `reviews` above: every
     * route in `wishlist-routes.ts` goes through the guarded `WishlistAdminController`, which
     * requires a staff `Principal` holding `wishlist:*` — a shopper managing their own wishlist has
     * none, and granting them an admin permission would be far worse than not having one.
     * `public-wishlist-routes.ts` calls the raw controller and scopes EVERY call by the
     * `customerRef` `CustomerGuard` resolved, never by one from the request.
     */
    readonly wishlist: WishlistController;
    /**
     * Loyalty's customer-facing read surface (T5.19). Same reasoning as `wishlist` above: every
     * route in `loyalty-routes.ts` requires a staff `Principal` holding `loyalty:*`, and a shopper
     * checking their own points balance has none. `public-loyalty-routes.ts` calls only
     * `.getByCustomer()`, scoped by the `customerRef` `CustomerGuard` resolved — never an `accountId`
     * from the request. Unlike Wishlist, no account is created on first access: `loyalty:open` stays
     * an admin/system-triggered action, so a customer with none yet gets an honest 404.
     */
    readonly loyalty: LoyaltyController;
  };
  /**
   * The PSP webhook ingress seam (C2-2/C2-6). A webhook has no admin Bearer token — its
   * authentication IS `paymentProvider.verifyWebhook`, so unlike every other Payments action it
   * cannot go through the guarded `PaymentsAdminController` facade (which, per its own doc comment,
   * deliberately excludes `recordWebhook` as "saga/PSP-internal, not exposed"). Same reasoning as
   * `publicReads` above: the unguarded, framework-agnostic controller + the PSP port, exposed so a
   * `public: true` route can verify the signature itself before recording anything.
   */
  readonly paymentsWebhook: {
    readonly recordWebhook: PaymentController["recordWebhook"];
    readonly verifyWebhook: PaymentProvider["verifyWebhook"];
  };
}

interface DrainableContext {
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/**
 * Composition root for the admin application. Wires the Phase-1 admin screens (Products, Inventory,
 * Orders, Customers, Discounts/Coupons) to their owning contexts by composing each context and
 * exposing a screen-oriented facade. Framework-agnostic (no HTTP server) — an HTTP/RPC transport
 * adapter for the frozen admin UI is deferred. Adds no business behaviour; each context keeps its own
 * in-memory persistence + outbox. Serializer/id/clock are injected and shared across contexts.
 */
export function wireAdmin(deps: AdminWiringDeps): WiredAdmin {
  const catalog = wireCatalog(deps);
  const inventory = wireInventory(deps);
  // Phase 3 Task 12 (C-3): `notifications` must exist before `ordersDeps` below is built — Orders
  // cannot receive a real NotificationPort adapter built from `notifications` if `notifications`
  // doesn't exist yet. Moved here (alongside `inventory` above) from its previous position much
  // further down (it used to be wired long after `orders`).
  const notifications = wireNotifications(deps);
  // Phase 3 Task 12 (C-3): real `InventoryPort`/`NotificationPort` adapters for Orders' outbound
  // ports, wired here (after `inventory`/`notifications` above) rather than left to `wireOrders`'s
  // own `deps.inventoryPort ?? new InMemoryInventoryAdapter()` / `deps.notifications ?? new
  // InMemoryNotificationAdapter()` fallbacks — same `checkoutDeps` convention Tasks 9-11 established
  // for Checkout, just for Orders instead.
  //
  // `OrdersInventoryAdapter` needs to read the SAME order's line items `wireOrders` itself manages,
  // but it is also one of `wireOrders`'s own inputs (`ordersDeps.inventoryPort` below) — the real
  // `OrderController` does not exist yet at this point. `ordersControllerCell` breaks that cycle
  // with a one-shot lazy forwarding object (not a second, state-disconnected `OrderController`
  // instance): built empty here, pointed at the real controller right after `wireOrders(ordersDeps)`
  // returns below. Every actual caller of `requestReservation` runs only after `wireAdmin` has fully
  // returned, so the cell is always populated by the time it matters. This is NOT the
  // Orders<->Payments composition cycle `paymentPort` needs a workaround for (two DIFFERENT `wireX`
  // calls each needing the other's controller, deferred to a later dispatch) — it is Orders' own
  // inbound port needing Orders' own outbound read surface, resolved entirely inside this single
  // `wireOrders` call.
  const ordersControllerCell: { controller?: Pick<OrderController, "getOrder"> } = {};
  const lazyOrdersController: Pick<OrderController, "getOrder"> = {
    getOrder: (input) => {
      if (ordersControllerCell.controller === undefined) {
        throw new Error(
          "OrdersInventoryAdapter: OrderController requested before wireOrders() completed",
        );
      }
      return ordersControllerCell.controller.getOrder(input);
    },
  };
  // Phase 3 Task 12b (C-3): a real `PaymentPort` adapter for Orders' `RequestPaymentCapture`, over
  // Payments' `createIntentLifecycle`/`captureLifecycle` chain. Unlike `ordersControllerCell` above
  // (Orders' own inbound port needing Orders' own outbound read surface, resolved entirely inside
  // this single `wireOrders` call), this is a genuine cross-context CYCLE: `OrdersPaymentAdapter`
  // needs Payments' `PaymentController`, but `wirePayments(deps)` runs well after `wireOrders(
  // ordersDeps)` below (`payments` is wired further down, alongside `checkout`) — and a LATER task
  // will make Payments need Orders' own controller for its own `ordersPort`, so neither `wireX` call
  // can unconditionally run first. Same one-shot lazy forwarding object idiom as
  // `ordersControllerCell`/`lazyOrdersController`, just resolving a two-context cycle instead of a
  // same-context self-reference: built empty here, pointed at the real `PaymentController` right
  // after `wirePayments(deps)` returns further down. Every real caller of
  // `paymentPort.requestCapture` runs only after `wireAdmin()` fully returns, long after both
  // `wireOrders` and `wirePayments` have completed, so the cell is always populated by the time it
  // matters.
  const paymentsControllerCell: {
    controller?: Pick<PaymentController, "createIntentLifecycle" | "captureLifecycle">;
  } = {};
  const lazyPaymentsController: Pick<
    PaymentController,
    "createIntentLifecycle" | "captureLifecycle"
  > = {
    createIntentLifecycle: (input) => {
      if (paymentsControllerCell.controller === undefined) {
        throw new Error(
          "OrdersPaymentAdapter: PaymentController requested before wirePayments() completed",
        );
      }
      return paymentsControllerCell.controller.createIntentLifecycle(input);
    },
    captureLifecycle: (input) => {
      if (paymentsControllerCell.controller === undefined) {
        throw new Error(
          "OrdersPaymentAdapter: PaymentController requested before wirePayments() completed",
        );
      }
      return paymentsControllerCell.controller.captureLifecycle(input);
    },
  };
  const ordersDeps = {
    ...deps,
    inventoryPort:
      deps.inventoryPort ??
      new OrdersInventoryAdapter(
        inventory.inventory,
        inventory.warehouseRepository,
        inventory.inventoryItemRepository,
        lazyOrdersController,
      ),
    notifications:
      deps.notifications ??
      new OrdersNotificationAdapter(notifications.notifications, deps.tenantId),
    paymentPort: deps.paymentPort ?? new OrdersPaymentAdapter(lazyPaymentsController),
  };
  const orders = wireOrders(ordersDeps);
  ordersControllerCell.controller = orders.orders;
  const identity = wireIdentity(deps);
  const customer360 = wireCustomer360(deps);
  const pricing = wirePricing(deps);
  const finance = wireFinance({ ...deps, postingAccounts: DEFAULT_FINANCE_POSTING_ACCOUNTS });
  const automation = wireAutomation(deps);
  const analytics = wireAnalytics();
  const cart = wireCart(deps);
  // Phase 3 Task 11 (C-3): `promotions` must exist before `checkoutDeps` below is built — Checkout
  // cannot receive a real PromotionValidationPort adapter built from `promotions` if `promotions`
  // doesn't exist yet. Moved here (alongside `catalog`/`inventory`/`pricing` above, all wired
  // early for the same reason) from its previous position after `checkout` further down.
  const promotions = wirePromotions(deps);
  // Phase 3 Task 9 (C-3, closes H-1): a real PricingValidationPort over Pricing's own
  // published-price data, wired here (after `pricing` above) rather than left to `wireCheckout`'s
  // own `deps.pricingValidation ?? new InMemoryPricingValidationAdapter()` fallback — the
  // fallback there stays reachable for callers who want to override it (e.g. tests), but
  // `wireAdmin` itself no longer boots Checkout against the offline stub by default.
  //
  // Phase 3 Task 10 (C-3): same treatment for InventoryValidationPort, wired here (after
  // `inventory` above) rather than left to `wireCheckout`'s own
  // `deps.inventoryValidation ?? new InMemoryInventoryValidationAdapter()` fallback.
  //
  // Phase 3 Task 11 (C-3): same treatment for PromotionValidationPort, wired here (after
  // `catalog`/`promotions` above) rather than left to `wireCheckout`'s own
  // `deps.promotionValidation ?? new InMemoryPromotionValidationAdapter()` fallback.
  //
  // Task 17a (C-2): a real `OrderCreationPort` adapter over Orders' `CreateOrderFromCheckout`,
  // wired here (after `orders` above) rather than left to `wireCheckout`'s own
  // `deps.orderCreation ?? new InMemoryOrderCreationAdapter()` fallback.
  const checkoutDeps = {
    ...deps,
    pricingValidation:
      deps.pricingValidation ??
      new PricingValidationAdapter(pricing.priceRepository, deps.tenantId),
    inventoryValidation:
      deps.inventoryValidation ??
      new InventoryValidationAdapter(inventory.inventory, inventory.warehouseRepository),
    promotionValidation:
      deps.promotionValidation ??
      new PromotionValidationAdapter(catalog.products, promotions.promotions, deps.tenantId),
    orderCreation: deps.orderCreation ?? new OrderCreationAdapter(orders.orders),
  };
  const checkout = wireCheckout(checkoutDeps);
  // Phase 3 Task 13 (C-3): real `ordersPort`/`paymentsNotifications` adapters for Payments'
  // outbound `notifyBestEffort` calls (`reportPaymentOutcome`/`notify`), wired here rather than
  // left to `wirePayments`'s own `deps.ordersPort ?? new InMemoryOrdersAdapter()` /
  // `deps.paymentsNotifications ?? new InMemoryNotificationAdapter()` fallbacks — same
  // `checkoutDeps`/`ordersDeps` convention Tasks 9-12 established for the other contexts.
  //
  // Unlike `paymentPort` above (Task 12b, the reverse Orders -> Payments direction), no
  // deferred-ref/lazy-cell trick is needed here: `orders` (line ~520) is wired well before this
  // point, so `orders.orders`, the real, already-built `OrderController`, can be passed directly
  // into `PaymentsOrdersAdapter`'s constructor.
  //
  // `financePort` is deliberately left untouched (Payments' own `deps.financePort ?? new
  // InMemoryFinanceAdapter()` fallback stays in effect) — not because Finance posts every one of
  // these ledger entries (it doesn't yet: Task 17b registered Finance's `OrdersPaidConsumer` on
  // `orders.order.paid` via apps/runtime/src/worker.ts, but the two consumers this port actually
  // shadows — `PaymentsCapturedConsumer`/`RefundsIssuedConsumer` in
  // services/finance/src/interfaces/finance-consumers.ts, over
  // payments.payment_intent.captured/.refunded — are still not registered with the Kafka consumer
  // fleet. That's an open gap, tracked as a separate follow-up, not something this phase closes)
  // but because a synchronous adapter here would be a second, uncoordinated write path over the
  // ledger the consumer fleet already writes. Full reasoning: apps/runtime/src/api.ts's
  // `assertProductionIntegrationPortsConfigured` doc comment.
  const paymentsDeps = {
    ...deps,
    ordersPort: deps.ordersPort ?? new PaymentsOrdersAdapter(orders.orders),
    paymentsNotifications:
      deps.paymentsNotifications ??
      new PaymentsNotificationAdapter(notifications.notifications, deps.tenantId),
  };
  const payments = wirePayments(paymentsDeps);
  // Populates `paymentsControllerCell` (see its declaration above, alongside `ordersDeps`) — from
  // this point on, `lazyPaymentsController`/`OrdersPaymentAdapter` resolve to the real
  // `PaymentController` instead of throwing.
  paymentsControllerCell.controller = payments.payments;
  const fulfillment = wireFulfillment(deps);
  const shipping = wireShipping(deps);
  const recommendations = wireRecommendations(deps);
  const reporting = wireReporting(deps);
  const returns = wireReturns(deps);
  const reviews = wireReviews(deps);
  const search = wireSearch(deps);
  const security = wireSecurity(deps);
  const content = wireContent(deps);
  const coupons = wireCoupons(deps);
  const localization = wireLocalization(deps);
  const loyalty = wireLoyalty(deps);
  const seo = wireSeo(deps);
  const components = wireComponents(deps);
  const theme = wireTheme(deps);
  const experience = wireExperience(deps);
  const experimentation = wireExperimentation(deps);
  const featureFlags = wireFeatureFlags(deps);
  const featureRegistry = wireFeatureRegistry(deps);
  const pages = wirePages(deps);
  const mediaLibrary = wireMediaLibrary(deps);
  const tenancy = wireTenancy(deps);
  const licensing = wireLicensing(deps);
  const platformConsole = wirePlatformConsole();
  const wishlist = wireWishlist(deps);
  const accessControl = deps.accessControl ?? new AllowAllAccessControl();
  const auditTrail = deps.auditTrail ?? new InMemoryAuditTrail();
  const guard = new AdminGuard({ accessControl, auditTrail, clock: deps.clock });

  // ── T5.17 customer authentication (storefront) ──
  /**
   * Sliding customer-session lifetime. T5.16 §2 recommends ~30-120 minutes: long enough that an
   * ordinary shopping session is not interrupted, far short of `GUEST_SESSION_COOKIE`'s 30 days,
   * because this session carries a real identity rather than an anonymous cart token. Refreshed on
   * activity by `POST /public/auth/refresh` (`Session.refresh` rotates the token and extends the
   * window), so the window is idle-time, not total-time.
   */
  const CUSTOMER_SESSION_TTL_SECONDS = 60 * 60;
  const customerGuard = new CustomerGuard({
    security: security.security,
    customers: identity.customers,
  });
  /**
   * The offline/local {@link CustomerCredentialsPort} adapter, bound to the reference adapters
   * `wireSecurity` already builds and exposes on `WiredSecurity`. This is the composition-root seam
   * the port exists for — no credential handling is implemented here, both calls are one-line
   * delegations into Security's own machinery.
   *
   * **Two limitations, both inherited from those reference adapters and neither introduced here**
   * (recorded in full in `docs/plans/BLOCKERS.md`'s T5.17 entry):
   *
   * 1. `InMemoryPasswordAuthProvider` holds its account map in process memory, so credentials
   *    registered here do not survive a restart and are not shared across replicas. It is the ONLY
   *    `AuthenticationProviderPort` `wireSecurity` registers for `"password"` today, and it already
   *    backs the admin console's `POST /security/authenticate` — this task reuses that seam rather
   *    than inventing a second credential store beside it, which is what "reuse the machinery, do
   *    not reimplement password storage" requires.
   * 2. `wireSecurity` returns its own in-memory `identityDirectory` on `WiredSecurity` even when a
   *    live one (Kratos) was injected, so `registerSubject` only takes effect on the in-memory
   *    branch. With a live directory the customer must already exist in it before registration —
   *    which is the correct production flow anyway (the IdP owns the subject), but it means this
   *    adapter is explicitly the local/offline one.
   *
   * A deployment with a real IdP replaces this whole object, not any part of the code above it.
   */
  const customerCredentials: CustomerCredentialsPort = {
    registerSubject: async (subjectRef) => {
      security.identityDirectory.register(subjectRef);
    },
    setPassword: async (identifier, password, principalExternalId) => {
      security.passwordProvider.register(identifier, password, principalExternalId);
    },
  };

  const contexts: readonly DrainableContext[] = [
    catalog,
    inventory,
    orders,
    identity,
    pricing,
    finance,
    automation,
    cart,
    checkout,
    payments,
    fulfillment,
    shipping,
    promotions,
    recommendations,
    reporting,
    returns,
    reviews,
    search,
    security,
    notifications,
    content,
    coupons,
    localization,
    loyalty,
    seo,
    components,
    theme,
    experience,
    experimentation,
    featureFlags,
    featureRegistry,
    pages,
    mediaLibrary,
    tenancy,
    licensing,
    wishlist,
  ];

  return {
    products: new ProductsAdminController({
      products: catalog.products,
      categories: catalog.categories,
      brands: catalog.brands,
      guard,
    }),
    inventory: new InventoryAdminController({
      inventory: inventory.inventory,
      warehouse: inventory.warehouse,
      guard,
    }),
    orders: new OrdersAdminController({ orders: orders.orders, guard }),
    customers: new CustomersAdminController({ customers: identity.customers, guard }),
    customer360: new Customer360AdminController({
      customer360: customer360.customer360,
      guard,
    }),
    access: new AccessAdminController({ access: identity.access, guard }),
    automation: new AutomationAdminController({ automation: automation.automation, guard }),
    analytics: new AnalyticsAdminController({ analytics: analytics.console, guard }),
    pricing: new PricingAdminController({
      prices: pricing.prices,
      priceLists: pricing.priceLists,
      registry: pricing.registry,
      guard,
    }),
    finance: new FinanceAdminController({ finance: finance.finance, guard }),
    cart: new CartAdminController({ cart: cart.cart, guard }),
    checkout: new CheckoutAdminController({ checkout: checkout.checkout, guard }),
    payments: new PaymentsAdminController({ payments: payments.payments, guard }),
    fulfillment: new FulfillmentAdminController({
      fulfillment: fulfillment.fulfillment,
      guard,
    }),
    shipping: new ShippingAdminController({ shipping: shipping.shipping, guard }),
    returns: new ReturnsAdminController({ returns: returns.returns, guard }),
    reviews: new ReviewsAdminController({ reviews: reviews.reviews, guard }),
    search: new SearchAdminController({ search: search.search, guard }),
    securityIdentity: new SecurityIdentityAdminController({
      security: security.security,
      guard,
    }),
    securitySessions: new SecuritySessionsAdminController({
      security: security.security,
      guard,
    }),
    securityAuthorization: new SecurityAuthorizationAdminController({
      security: security.security,
      guard,
    }),
    securitySecrets: new SecuritySecretsAdminController({
      security: security.security,
      guard,
    }),
    securityOperations: new SecurityOperationsAdminController({
      security: security.security,
      guard,
    }),
    securityAiGovernance: new SecurityAiGovernanceAdminController({
      security: security.security,
      guard,
    }),
    notifications: new NotificationsAdminController({
      notifications: notifications.notifications,
      guard,
    }),
    content: new ContentAdminController({ content: content.content, guard }),
    coupons: new CouponsAdminController({ coupons: coupons.coupons, guard }),
    experimentation: new ExperimentationAdminController({
      experimentation: experimentation.experimentation,
      guard,
    }),
    featureFlags: new FeatureFlagsAdminController({
      featureFlags: featureFlags.featureFlags,
      guard,
    }),
    featureRegistry: new FeatureRegistryAdminController({
      featureRegistry: featureRegistry.featureRegistry,
      guard,
    }),
    promotions: new PromotionsAdminController({ promotions: promotions.promotions, guard }),
    recommendations: new RecommendationsAdminController({
      recommendations: recommendations.recommendations,
      guard,
    }),
    reporting: new ReportingAdminController({ reporting: reporting.reporting, guard }),
    localization: new LocalizationAdminController({
      localization: localization.localization,
      guard,
    }),
    loyalty: new LoyaltyAdminController({ loyalty: loyalty.loyalty, guard }),
    seo: new SeoAdminController({ seo: seo.seo, guard }),
    components: new ComponentsAdminController({ components: components.components, guard }),
    theme: new ThemeAdminController({ theme: theme.theme, guard }),
    experience: new ExperienceAdminController({ experience: experience.experience, guard }),
    pages: new PagesAdminController({ pages: pages.pages, guard }),
    mediaLibrary: new MediaLibraryAdminController({
      mediaLibrary: mediaLibrary.mediaLibrary,
      guard,
    }),
    tenancy: new TenancyAdminController({ tenancy: tenancy.tenancy, guard }),
    licensing: new LicensingAdminController({ licensing: licensing.licensing, guard }),
    platformConsole: new PlatformConsoleAdminController({
      platformConsole: platformConsole.platformConsole,
      guard,
    }),
    wishlist: new WishlistAdminController({ wishlist: wishlist.wishlist, guard }),
    customerAuth: new CustomerAuthAdminController({
      security: security.security,
      customers: identity.customers,
      credentials: customerCredentials,
      guard: customerGuard,
      idGenerator: deps.idGenerator,
      sessionTtlSeconds: CUSTOMER_SESSION_TTL_SECONDS,
    }),
    drainOutbox: async () => {
      let total = 0;
      for (const context of contexts) {
        total += await context.drainOutbox();
      }
      return total;
    },
    get deliveredEventTypes(): readonly string[] {
      return contexts.flatMap((context) => [...context.deliveredEventTypes]);
    },
    publicReads: {
      products: catalog.products,
      categories: catalog.categories,
      collections: catalog.collections,
      prices: pricing.prices,
      inventory: inventory.inventory,
      cart: cart.cart,
      checkout: checkout.checkout,
      reviews: reviews.reviews,
      security: security.security,
      customers: identity.customers,
      wishlist: wishlist.wishlist,
      loyalty: loyalty.loyalty,
    },
    paymentsWebhook: {
      recordWebhook: (input) => payments.payments.recordWebhook(input),
      verifyWebhook: (payload, signature) =>
        payments.paymentProvider.verifyWebhook(payload, signature),
    },
  };
}
