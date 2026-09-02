import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { OrderDraft } from "@platform/checkout";
import type { Brand, Category, Product } from "@platform/catalog";
import type { Customer } from "@platform/identity";
import type { InventoryItem } from "@platform/inventory";
import type { Order } from "@platform/orders";
import { UnexpectedError } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import type { AdminResponse } from "../interfaces/admin-response";
import { analyticsRoutes } from "./analytics-routes";
import { automationRoutes } from "./automation-routes";
import { cartRoutes } from "./cart-routes";
import { checkoutRoutes } from "./checkout-routes";
import { componentsRoutes } from "./components-routes";
import { contentRoutes } from "./content-routes";
import { couponsRoutes } from "./coupons-routes";
import { customer360Routes } from "./customer-360-routes";
import { experienceRoutes } from "./experience-routes";
import { experimentationRoutes } from "./experimentation-routes";
import { featureFlagsRoutes } from "./feature-flags-routes";
import { featureRegistryRoutes } from "./feature-registry-routes";
import { fulfillmentRoutes } from "./fulfillment-routes";
import { licensingRoutes } from "./licensing-routes";
import { localizationRoutes } from "./localization-routes";
import { loyaltyRoutes } from "./loyalty-routes";
import { mediaLibraryRoutes } from "./media-library-routes";
import { paymentsRoutes } from "./payments-routes";
import { paymentsWebhookRoutes } from "./payments-webhook-routes";
import { pagesRoutes } from "./pages-routes";
import { notificationsRoutes } from "./notifications-routes";
import { platformConsoleRoutes } from "./platform-console-routes";
import { promotionsRoutes } from "./promotions-routes";
import { mapPage, publicCatalogRoutes } from "./public-catalog-routes";
import { publicAuthRoutes } from "./public-auth-routes";
import { publicCartRoutes } from "./public-cart-routes";
import { publicCheckoutRoutes } from "./public-checkout-routes";
import { publicLoyaltyRoutes } from "./public-loyalty-routes";
import { publicReviewsRoutes } from "./public-reviews-routes";
import { publicWishlistRoutes } from "./public-wishlist-routes";
import { recommendationsRoutes } from "./recommendations-routes";
import { reportingRoutes } from "./reporting-routes";
import { returnsRoutes } from "./returns-routes";
import { reviewsRoutes } from "./reviews-routes";
import { searchRoutes } from "./search-routes";
import { securityAiGovernanceRoutes } from "./security-ai-governance-routes";
import { securityAuthorizationRoutes } from "./security-authorization-routes";
import { securityIdentityRoutes } from "./security-identity-routes";
import { securityOperationsRoutes } from "./security-operations-routes";
import { securitySecretsRoutes } from "./security-secrets-routes";
import { securitySessionsRoutes } from "./security-sessions-routes";
import { seoRoutes } from "./seo-routes";
import { shippingRoutes } from "./shipping-routes";
import { tenancyRoutes } from "./tenancy-routes";
import { themeRoutes } from "./theme-routes";
import { wishlistRoutes } from "./wishlist-routes";

const placeOrderBody = z.object({
  customerRef: z.string().min(1),
  currency: z.string().length(3),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        name: z.string().min(1),
        unitPriceAmountMinor: z.number().int().positive(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  shippingAddress: z.object({
    line1: z.string().min(1),
    city: z.string().min(1),
    postalCode: z.string().min(1),
    country: z.string().min(1),
  }),
});

const createProductBody = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  variants: z
    .array(
      z.object({
        sku: z.string().min(1),
        priceAmountMinor: z.number().int().positive(),
        currency: z.string().length(3),
      }),
    )
    .min(1),
});

const orderIdParams = z.object({ orderId: z.string().min(1) });
const orderStatusValues = [
  "placed",
  "paid",
  "refunded",
  "created",
  "confirmed",
  "cancelled",
  "held",
  "resumed",
  "awaiting_payment",
  "payment_requested",
  "payment_received",
  "payment_failed",
  "ready_for_fulfillment",
  "fulfillment_requested",
  "fulfilled",
  "partially_fulfilled",
  "delivered",
  "return_requested",
  "returned",
  "refund_requested",
  "closed",
] as const;
const listOrdersQuery = z.object({
  first: z.coerce.number().int().min(1).max(100).optional(),
  after: z.string().min(1).optional(),
  status: z.enum(orderStatusValues).optional(),
  search: z.string().min(1).optional(),
});
const customerIdParams = z.object({ customerId: z.string().min(1) });
const listCustomersQuery = z.object({
  first: z.coerce.number().int().min(1).max(100).optional(),
  after: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
});

/**
 * `Order` (`@platform/orders`) is an `Entity`: `props`/`_id` are only TS-`protected`, erased at
 * runtime, so returning it directly would serialize its internals verbatim over the wire (the
 * exact defect `public-catalog-routes.ts` documents and fixes for the public storefront reads).
 * This route is authenticated, not public, but the same leak applies — so it gets the same
 * explicit, flat, hand-typed DTO rather than a passthrough.
 */
export interface OrderListItemDto {
  readonly id: string;
  readonly orderNumber: string;
  readonly customerRef: string;
  readonly status: string;
  readonly currency: string;
  readonly totalMinor: number;
  readonly createdAt: string;
}

function toOrderListItemDto(order: Order): OrderListItemDto {
  const firstEvent = order.history[0];
  if (firstEvent === undefined) {
    throw new UnexpectedError(`Corrupt order data: order ${order.id.toString()} has no history`);
  }
  return {
    id: order.id.toString(),
    orderNumber: order.orderNumber.value,
    customerRef: order.customerRef,
    status: order.status,
    currency: order.currency,
    totalMinor: order.totalAmount().amountMinor,
    createdAt: firstEvent.occurredAt.toISOString(),
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

/** The full single-order read shape (Order Detail screen) — same DTO discipline as {@link toOrderListItemDto}, extended with everything a detail view needs: line items, both addresses, the totals breakdown, cross-context references, and the full lifecycle history. */
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

function toOrderDetailDto(order: Order): OrderDetailDto {
  const firstEvent = order.history[0];
  if (firstEvent === undefined) {
    throw new UnexpectedError(`Corrupt order data: order ${order.id.toString()} has no history`);
  }
  const totals = order.totals;
  const billingAddress = order.billingAddress;
  return {
    id: order.id.toString(),
    orderNumber: order.orderNumber.value,
    customerRef: order.customerRef,
    status: order.status,
    currency: order.currency,
    totalMinor: order.totalAmount().amountMinor,
    createdAt: firstEvent.occurredAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id.toString(),
      productId: item.snapshot.productId,
      name: item.snapshot.name,
      unitPriceMinor: item.snapshot.unitPrice.amountMinor,
      quantity: item.quantity,
      lineTotalMinor: item.lineTotal.amountMinor,
    })),
    shippingAddress: {
      line1: order.shippingAddress.line1,
      city: order.shippingAddress.city,
      postalCode: order.shippingAddress.postalCode,
      country: order.shippingAddress.country,
    },
    billingAddress:
      billingAddress === undefined
        ? null
        : {
            line1: billingAddress.line1,
            city: billingAddress.city,
            postalCode: billingAddress.postalCode,
            country: billingAddress.country,
          },
    totals:
      totals === undefined
        ? null
        : {
            subtotalMinor: totals.subtotalMinor,
            taxMinor: totals.taxMinor,
            shippingMinor: totals.shippingMinor,
            discountMinor: totals.discountMinor,
            totalMinor: totals.totalMinor,
            currency: totals.currency,
          },
    checkoutRef: order.checkoutRef ?? null,
    paymentRef: order.paymentRef ?? null,
    fulfillmentRef: order.fulfillmentRef ?? null,
    history: order.history.map((entry) => ({
      type: entry.type,
      occurredAt: entry.occurredAt.toISOString(),
    })),
  };
}

/**
 * `Customer` (`@platform/identity`) is an `Entity` — same DTO discipline as {@link toOrderListItemDto}.
 */
export interface CustomerConsentDto {
  readonly scope: string;
  readonly granted: boolean;
  readonly occurredAt: string;
}

export interface CustomerDetailDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly addresses: readonly OrderAddressDto[];
  /** Full append-only consent log, occurrence order — current state per scope is the latest record. */
  readonly consents: readonly CustomerConsentDto[];
}

function toCustomerDetailDto(customer: Customer): CustomerDetailDto {
  return {
    id: customer.id.toString(),
    name: customer.name,
    email: customer.email.value,
    addresses: customer.addresses.map((address) => ({
      line1: address.line1,
      city: address.city,
      postalCode: address.postalCode,
      country: address.country,
    })),
    consents: customer.consents.map((consent) => ({
      scope: consent.scope.value,
      granted: consent.granted,
      occurredAt: consent.occurredAt.toISOString(),
    })),
  };
}

/** Flat row shape for the Customers list screen — no addresses/consents, just enough to search and navigate to detail. */
export interface CustomerListItemDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

function toCustomerListItemDto(customer: Customer): CustomerListItemDto {
  return { id: customer.id.toString(), name: customer.name, email: customer.email.value };
}

/**
 * Phase A.1 security fix (F-02): this used to accept a fully caller-supplied `totals` object and
 * pass it straight through to `Order.totalAmount()` — a forged `totalMinor` became the order's
 * captured amount, with nothing re-deriving it from Checkout. The fix drops `totals` from the
 * accepted shape entirely; the handler re-derives it from Checkout's own `generateOrderDraft()`
 * (the existing, already-wired snapshot Checkout assembles specifically to hand off to Orders —
 * `checkout-handoff.use-cases.ts`), keyed by the caller-supplied `checkoutRef` identifier only.
 */
const createOrderFromCheckoutBody = z
  .object({
    checkoutRef: z.string().min(1),
    customerRef: z.string().min(1),
    currency: z.string().length(3),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          name: z.string().min(1),
          unitPriceAmountMinor: z.number().int().min(0),
          quantity: z.number().int().positive(),
        }),
      )
      .min(1),
    billingAddress: z.object({
      line1: z.string().min(1),
      city: z.string().min(1),
      postalCode: z.string().min(1),
      country: z.string().min(1),
    }),
    shippingAddress: z.object({
      line1: z.string().min(1),
      city: z.string().min(1),
      postalCode: z.string().min(1),
      country: z.string().min(1),
    }),
  })
  .strict();
// Payment completion is never caller-asserted here (Sprint A1) — only via the dedicated /mark-paid
// action, which flows through the one authoritative `Order.completePayment` path.
const PAYMENT_COMPLETION_STATUSES = new Set(["paid", "payment_received"]);
const advanceOrderBody = z
  .object({ toStatus: z.string().min(1) })
  .refine((body) => !PAYMENT_COMPLETION_STATUSES.has(body.toStatus), {
    message:
      "Payment completion cannot be asserted via generic transitions — use POST /orders/:orderId/mark-paid",
    path: ["toStatus"],
  });
const markOrderPaidBody = z.object({ paymentRef: z.string().min(1) });

// -- Catalog: Products/Brands/Categories (Commerce Sprint 1, Sprint 4.2, Sprint 7.0) ------------

const productIdParams = z.object({ productId: z.string().min(1) });
const updateProductBody = z.object({ name: z.string().min(1), slug: z.string().min(1) });
const schedulePublishProductBody = z.object({ scheduledAt: z.coerce.date() });
const listProductsQuery = z.object({
  first: z.coerce.number().int().min(1).max(100).optional(),
  after: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
});
const variantIdParams = z.object({ productId: z.string().min(1), variantId: z.string().min(1) });
const addVariantBody = z.object({
  sku: z.string().min(1),
  priceAmountMinor: z.number().int().positive(),
  currency: z.string().length(3),
  selection: z.record(z.string()).optional(),
});
const updateVariantBody = z.object({
  sku: z.string().min(1),
  priceAmountMinor: z.number().int().positive(),
  currency: z.string().length(3),
});
const setProductOptionsBody = z.object({
  options: z.array(
    z.object({ name: z.string().min(1), values: z.array(z.string().min(1)).min(1) }),
  ),
});
const setProductSeoBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});
const setProductBrandBody = z.object({ brandId: z.string().min(1).nullable() });
const productInventoryParams = z.object({ productId: z.string().min(1) });
const assignCategoriesBody = z.object({ categoryIds: z.array(z.string().min(1)) });
const assetIdParams = z.object({ productId: z.string().min(1), assetId: z.string().min(1) });
const attachMediaBody = z.object({ assetId: z.string().min(1) });
const reorderMediaBody = z.object({ assetIds: z.array(z.string().min(1)) });

const createCategoryBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  parentId: z.string().min(1).optional(),
});
const categoryIdParams = z.object({ categoryId: z.string().min(1) });
const moveCategoryBody = z.object({ newParentId: z.string().min(1).nullable() });
const listCategoriesQuery = z.object({
  first: z.coerce.number().int().min(1).max(100).optional(),
  after: z.string().min(1).optional(),
});

const brandIdParams = z.object({ brandId: z.string().min(1) });
const createBrandBody = z.object({ name: z.string().min(1), slug: z.string().min(1) });
const updateBrandBody = z.object({ name: z.string().min(1) });

// -- Finance (Sprint 3.1, ADR-0024) -------------------------------------------------------------

const createAccountBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
});
const createCostCenterBody = z.object({ code: z.string().min(1), name: z.string().min(1) });
const createExpenseCategoryBody = z.object({
  name: z.string().min(1),
  costCenterRef: z.string().min(1).optional(),
});
const defineTaxProfileBody = z.object({
  jurisdiction: z.string().min(1),
  basisPointsPerRate: z.array(z.number().int().min(0).max(10_000)),
});
const setProductCostBody = z.object({
  productRef: z.string().min(1),
  currency: z.string().length(3),
  components: z.array(
    z.object({
      type: z.enum(["unit_cost", "freight", "duty", "handling", "other"]),
      amountMinor: z.number().int().min(0),
    }),
  ),
  effectiveAt: z.coerce.date(),
});
const openFiscalPeriodBody = z.object({ startDate: z.coerce.date(), endDate: z.coerce.date() });
const fiscalPeriodIdParams = z.object({ periodId: z.string().min(1) });
const setExchangeRateBody = z.object({
  baseCurrency: z.string().length(3),
  quoteCurrency: z.string().length(3),
  rate: z.number().positive(),
  effectiveAt: z.coerce.date(),
});
const recordExpenseBody = z.object({
  costCenterRef: z.string().min(1),
  categoryRef: z.string().min(1),
  amountMinor: z.number().int().min(0),
  currency: z.string().length(3),
  description: z.string().min(1),
  incurredAt: z.coerce.date(),
});
const createBudgetBody = z.object({
  costCenterRef: z.string().min(1),
  period: z.string().min(1),
  amountMinor: z.number().int().min(0),
  currency: z.string().length(3),
});
const budgetIdParams = z.object({ budgetId: z.string().min(1) });
const reviseBudgetBody = z.object({ amountMinor: z.number().int().min(0) });
const recordManualAdjustmentBody = z.object({
  sourceRef: z.string().min(1),
  debitAccountRef: z.string().min(1),
  creditAccountRef: z.string().min(1),
  amountMinor: z.number().int().min(0),
  currency: z.string().length(3),
  memo: z.string().optional(),
});
const generateForecastBody = z.object({
  figure: z.string().min(1),
  currency: z.string().length(3),
  horizonPeriods: z.number().int().positive(),
});
const periodRangeQuery = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  currency: z.string().length(3),
});
const readModelParams = z.object({ model: z.string().min(1), key: z.string().min(1) });
const readModelListParams = z.object({ model: z.string().min(1) });
const readModelQuery = z.object({
  dimension: z.string().min(1).optional(),
  periodKey: z.string().min(1).optional(),
  sort: z.string().min(1).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});

// -- Access: Users/Organizations/Memberships (Sprint 4.1, Option A) ----------------------------

const createUserBody = z.object({
  tenantId: z.string().min(1),
  email: z.string().min(1),
  name: z.string().min(1),
});
const userIdParams = z.object({ userId: z.string().min(1) });
const renameUserBody = z.object({ tenantId: z.string().min(1), name: z.string().min(1) });
const tenantScopedBody = z.object({ tenantId: z.string().min(1) });
const createOrganizationBody = z.object({
  tenantId: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
});
const organizationIdParams = z.object({ organizationId: z.string().min(1) });
const addMembershipBody = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  roleName: z.string().min(1),
});
const membershipIdParams = z.object({ membershipId: z.string().min(1) });
const changeMembershipRoleBody = z.object({
  tenantId: z.string().min(1),
  roleName: z.string().min(1),
});

// -- Pricing: price lists, prices, tax classes, pricing rules (Sprint 4.4) -----------------------

const createPriceListBody = z.object({ name: z.string().min(1), currency: z.string().length(3) });
const priceListIdParams = z.object({ priceListId: z.string().min(1) });
const createPriceBody = z.object({
  priceListId: z.string().min(1),
  productId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
  compareAtMinor: z.number().int().positive().optional(),
  costMinor: z.number().int().min(0).optional(),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
  taxClassRef: z.string().min(1).optional(),
});
const priceIdParams = z.object({ priceId: z.string().min(1) });
const changePriceBody = z.object({
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
  compareAtMinor: z.number().int().positive().optional(),
  costMinor: z.number().int().min(0).optional(),
});
const createTaxClassBody = z.object({ code: z.string().min(1), name: z.string().min(1) });
const createPricingRuleBody = z.object({
  type: z.enum(["percentage", "fixed_amount"]),
  value: z.number(),
  priority: z.number().int(),
});

// -- Inventory: stock + warehouse registry (Sprint 4.3) -----------------------------------------

const receiveStockBody = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  quantity: z.number().int().positive(),
});
const adjustInventoryBody = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  onHand: z.number().int().min(0),
});
const reserveStockBody = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  quantity: z.number().int().positive(),
  reference: z.string().min(1),
});
const releaseReservationBody = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  reservationId: z.string().min(1),
});
const commitReservationBody = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  reservationId: z.string().min(1),
});
const transferStockBody = z.object({
  productId: z.string().min(1),
  sourceWarehouseId: z.string().min(1),
  destinationWarehouseId: z.string().min(1),
  quantity: z.number().int().positive(),
});
const registerWarehouseBody = z.object({ code: z.string().min(1), name: z.string().min(1) });
const warehouseIdParams = z.object({ warehouseId: z.string().min(1) });

/**
 * `Product` (`@platform/catalog`) is an `Entity` — same DTO discipline as {@link toOrderListItemDto}.
 * `admin.products.listProducts`/`getProduct` used to return the raw aggregate's `props` verbatim
 * (Catalog's presenter has no DTO mapping, unlike Orders/Customers/PaymentIntent); these mappers
 * close that gap for the admin Products screen (Phase A.30) without touching Catalog itself.
 */
export interface ProductVariantDto {
  readonly id: string;
  readonly sku: string;
  readonly priceAmountMinor: number;
  readonly currency: string;
  readonly selection: Readonly<Record<string, string>> | null;
}

export interface ProductOptionDto {
  readonly name: string;
  readonly values: readonly string[];
}

export interface ProductListItemDto {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly variantCount: number;
  readonly priceAmountMinor: number | null;
  readonly currency: string | null;
}

export interface ProductDetailDto {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly scheduledAt: string | null;
  readonly brandId: string | null;
  readonly categoryIds: readonly string[];
  readonly options: readonly ProductOptionDto[];
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly variants: readonly ProductVariantDto[];
  readonly mediaAssetIds: readonly string[];
}

function toProductListItemDto(product: Product): ProductListItemDto {
  const firstVariant = product.variants[0];
  return {
    id: product.id.toString(),
    sku: product.sku.value,
    name: product.name,
    slug: product.slug.value,
    status: product.status.value,
    variantCount: product.variants.length,
    priceAmountMinor: firstVariant?.price.amountMinor ?? null,
    currency: firstVariant?.price.currency ?? null,
  };
}

function toProductDetailDto(product: Product): ProductDetailDto {
  return {
    id: product.id.toString(),
    sku: product.sku.value,
    name: product.name,
    slug: product.slug.value,
    status: product.status.value,
    scheduledAt: product.scheduledAt?.toISOString() ?? null,
    brandId: product.brand?.brandId ?? null,
    categoryIds: product.categories.map((category) => category.categoryId),
    options: product.options.map((option) => ({ name: option.name, values: option.values })),
    seoTitle: product.seo?.title ?? null,
    seoDescription: product.seo?.description ?? null,
    variants: product.variants.map((variant) => ({
      id: variant.id.toString(),
      sku: variant.sku.value,
      priceAmountMinor: variant.price.amountMinor,
      currency: variant.price.currency,
      selection: variant.selection?.values ?? null,
    })),
    mediaAssetIds: product.media.map((media) => media.assetId),
  };
}

/**
 * Admin projection of a product's stock — one row per warehouse (Phase A.30: Inventory had no
 * "stock by product" query at all; `InventoryItemRepository.findByProduct` closed that gap). The
 * live `reservations` set is withheld, same discipline as the public inventory DTO.
 */
export interface ProductInventoryRowDto {
  readonly warehouseId: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
}

function toProductInventoryRowDto(item: InventoryItem): ProductInventoryRowDto {
  return {
    warehouseId: item.warehouseId.value,
    onHand: item.stockLevel.onHand,
    reserved: item.stockLevel.reserved,
    available: item.stockLevel.available,
  };
}

export interface CategoryDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly parentId: string | null;
}

export interface BrandDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

function toCategoryDto(category: Category): CategoryDto {
  return {
    id: category.id.toString(),
    name: category.name,
    slug: category.slug.value,
    parentId: category.parentId,
  };
}

function toBrandDto(brand: Brand): BrandDto {
  return {
    id: brand.id.toString(),
    name: brand.name,
    slug: brand.slug.value,
  };
}

/**
 * The v1 admin HTTP surface (Sprint 2.6): pure delegation to the existing admin facade
 * controllers — zod validates the boundary, the facade authorizes + audits (AdminGuard), the
 * contexts own all behavior and presentation. Zero business logic here, by construction.
 * NOTE: `PlaceOrder` remains an internal/admin operation — the storefront tier must never map
 * price-bearing inputs directly (doc 22 / hardening P0-4 rule).
 */
export function adminRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/products",
      version: 1,
      permission: "products:create",
      idempotent: true,
      summary: "Create a product",
      schema: { body: createProductBody },
      handle: ({ body, context }) => admin.products.createProduct(context.principal, body),
    }),
    defineRoute({
      method: "GET",
      path: "/products",
      version: 1,
      permission: "products:read",
      summary: "List/search products (cursor-paginated)",
      schema: { querystring: listProductsQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.products.listProducts(context.principal, query), toProductListItemDto),
    }),
    defineRoute({
      method: "GET",
      path: "/products/:productId",
      version: 1,
      permission: "products:read",
      summary: "Get a product",
      schema: { params: productIdParams },
      handle: async ({ params, context }): Promise<AdminResponse> => {
        const response = await admin.products.getProduct(context.principal, params);
        if (response.status !== 200) {
          return response;
        }
        return { status: 200, body: toProductDetailDto(response.body as Product) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/products/:productId/inventory",
      version: 1,
      permission: "inventory:read",
      summary: "Get a product's stock across every warehouse",
      schema: { params: productInventoryParams },
      handle: async ({ params, context }): Promise<AdminResponse> => {
        const response = await admin.inventory.inventoryForProduct(context.principal, params);
        if (response.status !== 200) {
          return response;
        }
        return {
          status: 200,
          body: (response.body as readonly InventoryItem[]).map(toProductInventoryRowDto),
        };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/products/:productId",
      version: 1,
      permission: "products:update",
      idempotent: true,
      summary: "Update a product's name/slug",
      schema: { params: productIdParams, body: updateProductBody },
      handle: ({ params, body, context }) =>
        admin.products.updateProduct(context.principal, { productId: params.productId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/products/:productId/publish",
      version: 1,
      permission: "products:publish",
      idempotent: true,
      summary: "Publish a product",
      schema: { params: productIdParams },
      handle: ({ params, context }) => admin.products.publishProduct(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/products/:productId/schedule-publish",
      version: 1,
      permission: "products:publish",
      idempotent: true,
      summary: "Schedule a product to publish in the future",
      schema: { params: productIdParams, body: schedulePublishProductBody },
      handle: ({ params, body, context }) =>
        admin.products.schedulePublishProduct(context.principal, {
          productId: params.productId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/products/:productId/unpublish",
      version: 1,
      permission: "products:publish",
      idempotent: true,
      summary: "Unpublish a product",
      schema: { params: productIdParams },
      handle: ({ params, context }) => admin.products.unpublishProduct(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/products/:productId/archive",
      version: 1,
      permission: "products:update",
      idempotent: true,
      summary: "Archive a product",
      schema: { params: productIdParams },
      handle: ({ params, context }) => admin.products.archiveProduct(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/products/:productId/delete",
      version: 1,
      permission: "products:delete",
      idempotent: true,
      summary: "Soft-delete a product",
      schema: { params: productIdParams },
      handle: ({ params, context }) => admin.products.deleteProduct(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/products/:productId/variants",
      version: 1,
      permission: "products:update",
      idempotent: true,
      summary: "Add a variant to a product",
      schema: { params: productIdParams, body: addVariantBody },
      handle: ({ params, body, context }) =>
        admin.products.addVariant(context.principal, { productId: params.productId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/products/:productId/variants/:variantId/remove",
      version: 1,
      permission: "products:update",
      idempotent: true,
      summary: "Remove a variant from a product",
      schema: { params: variantIdParams },
      handle: ({ params, context }) => admin.products.removeVariant(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/products/:productId/variants/:variantId",
      version: 1,
      permission: "products:update",
      idempotent: true,
      summary: "Edit a variant's sku/price",
      schema: { params: variantIdParams, body: updateVariantBody },
      handle: ({ params, body, context }) =>
        admin.products.updateVariant(context.principal, { ...params, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/products/:productId/options",
      version: 1,
      permission: "products:update",
      idempotent: true,
      summary: "Replace a product's declared option set (draft only)",
      schema: { params: productIdParams, body: setProductOptionsBody },
      handle: ({ params, body, context }) =>
        admin.products.setProductOptions(context.principal, {
          productId: params.productId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/products/:productId/seo",
      version: 1,
      permission: "products:update",
      idempotent: true,
      summary: "Set a product's SEO overrides",
      schema: { params: productIdParams, body: setProductSeoBody },
      handle: ({ params, body, context }) =>
        admin.products.setProductSeo(context.principal, { productId: params.productId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/products/:productId/brand",
      version: 1,
      permission: "products:update",
      idempotent: true,
      summary: "Assign or clear a product's brand",
      schema: { params: productIdParams, body: setProductBrandBody },
      handle: ({ params, body, context }) =>
        admin.products.setProductBrand(context.principal, { productId: params.productId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/products/:productId/categories",
      version: 1,
      permission: "products:update",
      idempotent: true,
      summary: "Set a product's category assignments",
      schema: { params: productIdParams, body: assignCategoriesBody },
      handle: ({ params, body, context }) =>
        admin.products.assignCategories(context.principal, {
          productId: params.productId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/products/:productId/media",
      version: 1,
      permission: "products:update",
      idempotent: true,
      summary: "Attach a media asset to a product",
      schema: { params: productIdParams, body: attachMediaBody },
      handle: ({ params, body, context }) =>
        admin.products.attachMedia(context.principal, { productId: params.productId, ...body }),
    }),
    defineRoute({
      method: "DELETE",
      path: "/products/:productId/media/:assetId",
      version: 1,
      permission: "products:update",
      idempotent: true,
      summary: "Detach a media asset from a product",
      schema: { params: assetIdParams },
      handle: ({ params, context }) => admin.products.detachMedia(context.principal, params),
    }),
    defineRoute({
      method: "PUT",
      path: "/products/:productId/media",
      version: 1,
      permission: "products:update",
      idempotent: true,
      summary: "Reorder a product's attached media",
      schema: { params: productIdParams, body: reorderMediaBody },
      handle: ({ params, body, context }) =>
        admin.products.reorderMedia(context.principal, { productId: params.productId, ...body }),
    }),
    defineRoute({
      method: "GET",
      path: "/categories",
      version: 1,
      permission: "categories:read",
      summary: "List categories (cursor-paginated)",
      schema: { querystring: listCategoriesQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.products.listCategories(context.principal, query), toCategoryDto),
    }),
    defineRoute({
      method: "POST",
      path: "/categories",
      version: 1,
      permission: "categories:create",
      idempotent: true,
      summary: "Create a category",
      schema: { body: createCategoryBody },
      handle: ({ body, context }) => admin.products.createCategory(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/categories/:categoryId/move",
      version: 1,
      permission: "categories:update",
      idempotent: true,
      summary: "Reparent a category",
      schema: { params: categoryIdParams, body: moveCategoryBody },
      handle: ({ params, body, context }) =>
        admin.products.moveCategory(context.principal, { categoryId: params.categoryId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/categories/:categoryId/delete",
      version: 1,
      permission: "categories:delete",
      idempotent: true,
      summary: "Soft-delete a category (rejected if it has live children)",
      schema: { params: categoryIdParams },
      handle: ({ params, context }) => admin.products.deleteCategory(context.principal, params),
    }),
    defineRoute({
      method: "GET",
      path: "/brands",
      version: 1,
      permission: "brands:read",
      summary: "List brands (cursor-paginated)",
      schema: { querystring: listCategoriesQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.products.listBrands(context.principal, query), toBrandDto),
    }),
    defineRoute({
      method: "POST",
      path: "/brands",
      version: 1,
      permission: "brands:create",
      idempotent: true,
      summary: "Create a brand",
      schema: { body: createBrandBody },
      handle: ({ body, context }) => admin.products.createBrand(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/brands/:brandId",
      version: 1,
      permission: "brands:update",
      idempotent: true,
      summary: "Rename a brand",
      schema: { params: brandIdParams, body: updateBrandBody },
      handle: ({ params, body, context }) =>
        admin.products.updateBrand(context.principal, { id: params.brandId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/brands/:brandId/delete",
      version: 1,
      permission: "brands:delete",
      idempotent: true,
      summary: "Soft-delete a brand",
      schema: { params: brandIdParams },
      handle: ({ params, context }) =>
        admin.products.deleteBrand(context.principal, { brandId: params.brandId }),
    }),
    defineRoute({
      method: "POST",
      path: "/orders",
      version: 1,
      permission: "orders:place",
      idempotent: true,
      summary: "Place an order (backoffice)",
      schema: { body: placeOrderBody },
      handle: ({ body, context }) => admin.orders.placeOrder(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/orders/:orderId/refund",
      version: 1,
      permission: "orders:refund",
      idempotent: true,
      summary: "Refund an order",
      schema: { params: orderIdParams },
      handle: ({ params, context }) =>
        admin.orders.refundOrder(context.principal, { orderId: params.orderId }),
    }),
    defineRoute({
      method: "POST",
      path: "/orders/from-checkout",
      version: 1,
      permission: "orders:create_from_checkout",
      idempotent: true,
      summary: "Create an order from Checkout's order-draft snapshot",
      schema: { body: createOrderFromCheckoutBody },
      handle: async ({ body, context }): Promise<AdminResponse> => {
        const draftResponse = await admin.checkout.generateOrderDraft(context.principal, {
          checkoutSessionId: body.checkoutRef,
        });
        if (draftResponse.status < 200 || draftResponse.status >= 300) {
          return draftResponse;
        }
        const draft = draftResponse.body as OrderDraft;
        if (draft.totals.currency !== body.currency) {
          return {
            status: 409,
            body: {
              message: "Checkout session currency does not match the requested order currency",
            },
          };
        }
        return admin.orders.createFromCheckout(context.principal, {
          ...body,
          totals: {
            subtotalMinor: draft.totals.subtotalMinor,
            taxMinor: draft.totals.taxMinor,
            shippingMinor: draft.totals.shippingMinor,
            discountMinor: draft.totals.discountMinor,
            totalMinor: draft.totals.totalMinor,
          },
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/orders/:orderId/advance",
      version: 1,
      permission: "orders:advance",
      idempotent: true,
      summary:
        "Advance an order to an explicit, validated lifecycle status (payment completion excluded — see /mark-paid)",
      schema: { params: orderIdParams, body: advanceOrderBody },
      handle: ({ params, body, context }) =>
        admin.orders.advanceOrder(context.principal, {
          orderId: params.orderId,
          toStatus: body.toStatus as Parameters<typeof admin.orders.advanceOrder>[1]["toStatus"],
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/orders/:orderId/mark-paid",
      version: 1,
      permission: "orders:mark_paid",
      idempotent: true,
      summary:
        "Mark an order paid (the one authoritative payment-completion path — legacy and checkout/saga orders alike)",
      schema: { params: orderIdParams, body: markOrderPaidBody },
      handle: ({ params, body, context }) =>
        admin.orders.markOrderPaid(context.principal, {
          orderId: params.orderId,
          paymentRef: body.paymentRef,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/orders/:orderId/request-payment-capture",
      version: 1,
      permission: "orders:request_payment_capture",
      summary: "Request payment capture via the PaymentPort",
      schema: { params: orderIdParams },
      handle: ({ params, context }) =>
        admin.orders.requestPaymentCapture(context.principal, { orderId: params.orderId }),
    }),
    defineRoute({
      method: "POST",
      path: "/orders/:orderId/request-fulfillment",
      version: 1,
      permission: "orders:request_fulfillment",
      summary: "Request fulfillment via the Inventory/Shipping ports",
      schema: { params: orderIdParams },
      handle: ({ params, context }) =>
        admin.orders.requestFulfillment(context.principal, { orderId: params.orderId }),
    }),
    defineRoute({
      method: "GET",
      path: "/orders",
      version: 1,
      permission: "orders:read",
      summary: "List orders, most recently placed first (cursor-paginated)",
      schema: { querystring: listOrdersQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.orders.listOrders(context.principal, query), toOrderListItemDto),
    }),
    defineRoute({
      method: "GET",
      path: "/orders/:orderId",
      version: 1,
      permission: "orders:read",
      summary: "Get a single order",
      schema: { params: orderIdParams },
      handle: async ({ params, context }): Promise<AdminResponse> => {
        const response = await admin.orders.getOrder(context.principal, {
          orderId: params.orderId,
        });
        if (response.status !== 200) {
          return response;
        }
        return { status: 200, body: toOrderDetailDto(response.body as Order) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/customers",
      version: 1,
      permission: "customers:read",
      summary: "List customers, most recently registered first (cursor-paginated)",
      schema: { querystring: listCustomersQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.customers.listCustomers(context.principal, query),
          toCustomerListItemDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/customers/:customerId",
      version: 1,
      permission: "customers:read",
      summary: "Get a single customer",
      schema: { params: customerIdParams },
      handle: async ({ params, context }): Promise<AdminResponse> => {
        const response = await admin.customers.getCustomer(context.principal, params);
        if (response.status !== 200) {
          return response;
        }
        return { status: 200, body: toCustomerDetailDto(response.body as Customer) };
      },
    }),
    defineRoute({
      method: "POST",
      path: "/finance/accounts",
      version: 1,
      permission: "finance:manage",
      idempotent: true,
      summary: "Create a chart-of-accounts entry",
      schema: { body: createAccountBody },
      handle: ({ body, context }) => admin.finance.createAccount(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/finance/cost-centers",
      version: 1,
      permission: "finance:manage",
      idempotent: true,
      summary: "Create a cost center",
      schema: { body: createCostCenterBody },
      handle: ({ body, context }) => admin.finance.createCostCenter(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/finance/expense-categories",
      version: 1,
      permission: "finance:manage",
      idempotent: true,
      summary: "Create an expense category",
      schema: { body: createExpenseCategoryBody },
      handle: ({ body, context }) => admin.finance.createExpenseCategory(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/finance/tax-profiles",
      version: 1,
      permission: "finance:manage",
      idempotent: true,
      summary: "Define a jurisdiction's tax profile",
      schema: { body: defineTaxProfileBody },
      handle: ({ body, context }) => admin.finance.defineTaxProfile(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/finance/product-costs",
      version: 1,
      permission: "finance:manage",
      idempotent: true,
      summary: "Record an effective-dated product cost snapshot",
      schema: { body: setProductCostBody },
      handle: ({ body, context }) => admin.finance.setProductCost(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/finance/fiscal-periods",
      version: 1,
      permission: "finance:manage",
      idempotent: true,
      summary: "Open a fiscal period",
      schema: { body: openFiscalPeriodBody },
      handle: ({ body, context }) => admin.finance.openFiscalPeriod(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/finance/fiscal-periods/:periodId/close",
      version: 1,
      permission: "finance:manage",
      idempotent: true,
      summary: "Close a fiscal period (step-up)",
      schema: { params: fiscalPeriodIdParams },
      handle: ({ params, context }) =>
        admin.finance.closeFiscalPeriod(context.principal, { periodId: params.periodId }),
    }),
    defineRoute({
      method: "POST",
      path: "/finance/exchange-rates",
      version: 1,
      permission: "finance:manage",
      idempotent: true,
      summary: "Set a new historical exchange rate (step-up)",
      schema: { body: setExchangeRateBody },
      handle: ({ body, context }) => admin.finance.setExchangeRate(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/finance/expenses",
      version: 1,
      permission: "finance:manage",
      idempotent: true,
      summary: "Record a merchant expense",
      schema: { body: recordExpenseBody },
      handle: ({ body, context }) => admin.finance.recordExpense(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/finance/budgets",
      version: 1,
      permission: "finance:manage",
      idempotent: true,
      summary: "Create a budget",
      schema: { body: createBudgetBody },
      handle: ({ body, context }) => admin.finance.createBudget(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/finance/budgets/:budgetId/revise",
      version: 1,
      permission: "finance:manage",
      idempotent: true,
      summary: "Revise a budget's amount",
      schema: { params: budgetIdParams, body: reviseBudgetBody },
      handle: ({ params, body, context }) =>
        admin.finance.reviseBudget(context.principal, { budgetId: params.budgetId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/finance/manual-adjustments",
      version: 1,
      permission: "finance:manage",
      idempotent: true,
      summary: "Post a manual balanced adjustment journal (step-up)",
      schema: { body: recordManualAdjustmentBody },
      handle: ({ body, context }) => admin.finance.recordManualAdjustment(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/finance/forecasts",
      version: 1,
      permission: "finance:read",
      idempotent: false,
      summary: "Generate an AI forecast proposal (proposes-only)",
      schema: { body: generateForecastBody },
      handle: ({ body, context }) => admin.finance.generateForecast(context.principal, body),
    }),
    defineRoute({
      method: "GET",
      path: "/finance/trial-balance",
      version: 1,
      permission: "finance:read",
      summary: "Trial balance for a period",
      schema: { querystring: periodRangeQuery },
      handle: ({ query, context }) => admin.finance.trialBalance(context.principal, query),
    }),
    defineRoute({
      method: "GET",
      path: "/finance/income-statement",
      version: 1,
      permission: "finance:read",
      summary: "Income statement for a period",
      schema: { querystring: periodRangeQuery },
      handle: ({ query, context }) => admin.finance.incomeStatement(context.principal, query),
    }),
    defineRoute({
      method: "GET",
      path: "/finance/balance-sheet",
      version: 1,
      permission: "finance:read",
      summary: "Balance sheet as of a period end",
      schema: { querystring: periodRangeQuery },
      handle: ({ query, context }) => admin.finance.balanceSheet(context.principal, query),
    }),
    defineRoute({
      method: "GET",
      path: "/finance/read-models/:model/:key",
      version: 1,
      permission: "finance:read",
      summary: "A single projected Finance read-model row",
      schema: { params: readModelParams },
      handle: ({ params, context }) => admin.finance.getReadModel(context.principal, params),
    }),
    defineRoute({
      method: "GET",
      path: "/finance/read-models/:model",
      version: 1,
      permission: "finance:read",
      summary:
        "Paginated rows for a Finance read model (dimension/periodKey filter, sort, cursor; limit <= 200)",
      schema: { params: readModelListParams, querystring: readModelQuery },
      handle: ({ params, query, context }) =>
        admin.finance.queryReadModel(context.principal, { model: params.model, ...query }),
    }),
    defineRoute({
      method: "POST",
      path: "/users",
      version: 1,
      permission: "users:create",
      idempotent: true,
      summary: "Create a user",
      schema: { body: createUserBody },
      handle: ({ body, context }) => admin.access.createUser(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/users/:userId",
      version: 1,
      permission: "users:rename",
      idempotent: true,
      summary: "Rename a user",
      schema: { params: userIdParams, body: renameUserBody },
      handle: ({ params, body, context }) =>
        admin.access.renameUser(context.principal, { userId: params.userId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/users/:userId/deactivate",
      version: 1,
      permission: "users:deactivate",
      idempotent: true,
      summary: "Deactivate a user",
      schema: { params: userIdParams, body: tenantScopedBody },
      handle: ({ params, body, context }) =>
        admin.access.deactivateUser(context.principal, { userId: params.userId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/organizations",
      version: 1,
      permission: "organizations:create",
      idempotent: true,
      summary: "Create an organization",
      schema: { body: createOrganizationBody },
      handle: ({ body, context }) => admin.access.createOrganization(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/organizations/:organizationId/archive",
      version: 1,
      permission: "organizations:archive",
      idempotent: true,
      summary: "Archive an organization",
      schema: { params: organizationIdParams, body: tenantScopedBody },
      handle: ({ params, body, context }) =>
        admin.access.archiveOrganization(context.principal, {
          organizationId: params.organizationId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/memberships",
      version: 1,
      permission: "memberships:add",
      idempotent: true,
      summary: "Add a user to an organization with a role",
      schema: { body: addMembershipBody },
      handle: ({ body, context }) => admin.access.addMembership(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/memberships/:membershipId/role",
      version: 1,
      permission: "memberships:change_role",
      idempotent: true,
      summary: "Change a membership's role",
      schema: { params: membershipIdParams, body: changeMembershipRoleBody },
      handle: ({ params, body, context }) =>
        admin.access.changeMembershipRole(context.principal, {
          membershipId: params.membershipId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/price-lists",
      version: 1,
      permission: "pricing:create_price_list",
      idempotent: true,
      summary: "Create a draft price list",
      schema: { body: createPriceListBody },
      handle: ({ body, context }) => admin.pricing.createPriceList(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/price-lists/:priceListId/activate",
      version: 1,
      permission: "pricing:activate_price_list",
      idempotent: true,
      summary: "Activate a draft price list",
      schema: { params: priceListIdParams },
      handle: ({ params, context }) => admin.pricing.activatePriceList(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/prices",
      version: 1,
      permission: "pricing:create_price",
      idempotent: true,
      summary: "Create a price (compare-at/cost/effective window/tax class optional)",
      schema: { body: createPriceBody },
      handle: ({ body, context }) => admin.pricing.createPrice(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/prices/:priceId",
      version: 1,
      permission: "pricing:change_price",
      idempotent: true,
      summary: "Change a price's amount (and optionally compare-at/cost)",
      schema: { params: priceIdParams, body: changePriceBody },
      handle: ({ params, body, context }) =>
        admin.pricing.changePrice(context.principal, { priceId: params.priceId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/prices/:priceId/publish",
      version: 1,
      permission: "pricing:publish_price",
      idempotent: true,
      summary: "Publish a draft price",
      schema: { params: priceIdParams },
      handle: ({ params, context }) => admin.pricing.publishPrice(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/tax-classes",
      version: 1,
      permission: "pricing:create_tax_class",
      idempotent: true,
      summary: "Create a tax classification",
      schema: { body: createTaxClassBody },
      handle: ({ body, context }) => admin.pricing.createTaxClass(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/pricing-rules",
      version: 1,
      permission: "pricing:create_pricing_rule",
      idempotent: true,
      summary: "Create a list-price adjustment rule (percentage capped at 100)",
      schema: { body: createPricingRuleBody },
      handle: ({ body, context }) => admin.pricing.createPricingRule(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/inventory/receive",
      version: 1,
      permission: "inventory:receive",
      idempotent: true,
      summary: "Receive stock for a product at a warehouse",
      schema: { body: receiveStockBody },
      handle: ({ body, context }) => admin.inventory.receiveStock(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/inventory/adjust",
      version: 1,
      permission: "inventory:adjust",
      idempotent: true,
      summary: "Adjust an item's on-hand stock",
      schema: { body: adjustInventoryBody },
      handle: ({ body, context }) => admin.inventory.adjustStock(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/inventory/reserve",
      version: 1,
      permission: "inventory:reserve",
      summary: "Reserve available stock for an order/cart",
      schema: { body: reserveStockBody },
      handle: ({ body, context }) => admin.inventory.reserveStock(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/inventory/release",
      version: 1,
      permission: "inventory:release",
      idempotent: true,
      summary: "Release a held reservation",
      schema: { body: releaseReservationBody },
      handle: ({ body, context }) => admin.inventory.releaseReservation(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/inventory/commit",
      version: 1,
      permission: "inventory:commit",
      idempotent: true,
      summary: "Commit a held reservation (ADR-0013 fulfillment step)",
      schema: { body: commitReservationBody },
      handle: ({ body, context }) => admin.inventory.commitReservation(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/inventory/transfer",
      version: 1,
      permission: "inventory:transfer",
      summary: "Transfer unreserved stock between warehouses",
      schema: { body: transferStockBody },
      handle: ({ body, context }) => admin.inventory.transferStock(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/warehouses",
      version: 1,
      permission: "warehouse:register",
      idempotent: true,
      summary: "Register a warehouse",
      schema: { body: registerWarehouseBody },
      handle: ({ body, context }) => admin.inventory.registerWarehouse(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/warehouses/:warehouseId/deactivate",
      version: 1,
      permission: "warehouse:deactivate",
      idempotent: true,
      summary: "Deactivate a warehouse",
      schema: { params: warehouseIdParams },
      handle: ({ params, context }) =>
        admin.inventory.deactivateWarehouse(context.principal, params),
    }),
    ...analyticsRoutes(admin),
    ...automationRoutes(admin),
    ...cartRoutes(admin),
    ...checkoutRoutes(admin),
    ...paymentsRoutes(admin),
    ...paymentsWebhookRoutes(admin),
    ...fulfillmentRoutes(admin),
    ...shippingRoutes(admin),
    ...returnsRoutes(admin),
    ...reviewsRoutes(admin),
    ...searchRoutes(admin),
    ...securityAiGovernanceRoutes(admin),
    ...securityAuthorizationRoutes(admin),
    ...securityIdentityRoutes(admin),
    ...securityOperationsRoutes(admin),
    ...securitySecretsRoutes(admin),
    ...securitySessionsRoutes(admin),
    ...notificationsRoutes(admin),
    ...contentRoutes(admin),
    ...couponsRoutes(admin),
    ...localizationRoutes(admin),
    ...loyaltyRoutes(admin),
    ...seoRoutes(admin),
    ...componentsRoutes(admin),
    ...themeRoutes(admin),
    ...experienceRoutes(admin),
    ...experimentationRoutes(admin),
    ...featureFlagsRoutes(admin),
    ...featureRegistryRoutes(admin),
    ...pagesRoutes(admin),
    ...mediaLibraryRoutes(admin),
    ...tenancyRoutes(admin),
    ...licensingRoutes(admin),
    ...platformConsoleRoutes(admin),
    ...promotionsRoutes(admin),
    ...publicAuthRoutes(admin),
    ...publicCatalogRoutes(admin),
    ...publicCartRoutes(admin),
    ...publicCheckoutRoutes(admin),
    ...publicReviewsRoutes(admin),
    ...publicWishlistRoutes(admin),
    ...publicLoyaltyRoutes(admin),
    ...recommendationsRoutes(admin),
    ...reportingRoutes(admin),
    ...wishlistRoutes(admin),
    ...customer360Routes(admin),
  ] as readonly RouteDefinition[];
}
