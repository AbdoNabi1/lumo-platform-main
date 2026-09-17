import { SystemClock } from "@platform/clock";
import { createPrismaClient } from "@platform/db";
import { JsonEventSerializer, type EventSerializer } from "@platform/domain-events";
import { CryptoIdGenerator } from "@platform/id";
import { wireCatalog } from "@platform/catalog";
import { wireContent } from "@platform/content";
import { wireIdentity } from "@platform/identity";
import { wireInventory } from "@platform/inventory";
import { wireOrders } from "@platform/orders";
import { wirePricing } from "@platform/pricing";
import { wirePromotions } from "@platform/promotions";
import { wireReviews } from "@platform/reviews";
import { logger } from "@platform/utils";

/**
 * Rich demo dataset (Task 8), layered on top of `seed.ts`'s baseline catalog. Wires the Orders/
 * Promotions/Reviews/Content composition roots the exact same way `seed.ts` wires
 * Catalog/Identity/Pricing/Inventory — real Postgres, no raw Prisma inserts, so every write goes
 * through its own use-case (domain invariants + outbox events included, not bypassed).
 *
 * Run `seed.ts` first (this script does not depend on its rows at runtime, but the platform has
 * nothing worth demoing without the baseline catalog it creates). This script creates its own
 * brand/categories/products/price-list/warehouse rather than reusing `seed.ts`'s, since a plain
 * script has no cheap way to look those ids back up — "layers on top" here means "adds more rows",
 * not "shares parent ids".
 *
 * `TENANT_ID` matches `TENANT_DEFAULT_ID`'s default ("tenant-local", see apps/runtime/src/config.ts
 * and .env.example) the same way `seed.ts`'s does, so the runtime API's default tenant resolves
 * straight to this data too.
 *
 * Idempotent — safe to re-run (mirrors `scripts/ops/seed-ory-network.mjs`'s check-before-create
 * pattern). Every section below looks its entity up by its natural key through a real read
 * use-case (or, where the composition root exposes the repository directly for cross-context
 * reads — `warehouseRepository`/`inventoryItemRepository`/`priceRepository`, same convention the
 * Checkout adapters use — through that) before creating it, and reuses the existing id instead of
 * re-creating. Two entities have a documented, narrower guarantee because no lookup-by-natural-key
 * use case exists for them at all (see the comments at those two call sites): price lists, and
 * orders (which have no natural key to begin with — see the Orders section).
 */
const TENANT_ID = "tenant-local";
const CURRENCY = "USD";

interface ControllerResponse {
  readonly status: number;
  readonly body: unknown;
}

/** Unwraps a controller response, throwing with the response body on any non-2xx status. */
function unwrap<T>(response: ControllerResponse, action: string): T {
  if (response.status >= 200 && response.status < 300) {
    return response.body as T;
  }
  throw new Error(`${action} failed (HTTP ${response.status}): ${JSON.stringify(response.body)}`);
}

/** Like {@link unwrap}, but a 404 ("not found") unwraps to `null` instead of throwing — for existence checks by natural key. */
function unwrapOrNull<T>(response: ControllerResponse, action: string): T | null {
  if (response.status === 404) {
    return null;
  }
  return unwrap<T>(response, action);
}

/** Minimal shape read off a domain aggregate returned by a `list`/`get` use-case (these return the aggregate itself, not a DTO — unlike `create`, which returns `{ id }`). */
interface IdLike {
  toString(): string;
}
interface ValueLike {
  readonly value: string;
}

interface CategorySeed {
  readonly name: string;
  readonly slug: string;
}

const CATEGORY_SEEDS: readonly CategorySeed[] = [
  { name: "Outdoor Play", slug: "outdoor-play" },
  { name: "Educational Toys", slug: "educational-toys" },
  { name: "Tech Gadgets", slug: "tech-gadgets" },
];

interface ProductSeed {
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly variantSku: string;
  readonly priceAmountMinor: number;
  readonly categorySlug: string;
}

const PRODUCT_SEEDS: readonly ProductSeed[] = [
  {
    sku: "OD-101",
    name: "Trampoline 8ft",
    slug: "trampoline-8ft",
    variantSku: "OD-101-STD",
    priceAmountMinor: 24999,
    categorySlug: "outdoor-play",
  },
  {
    sku: "OD-102",
    name: "Kids Scooter",
    slug: "kids-scooter",
    variantSku: "OD-102-STD",
    priceAmountMinor: 5999,
    categorySlug: "outdoor-play",
  },
  {
    sku: "OD-103",
    name: "Water Balloon Set",
    slug: "water-balloon-set",
    variantSku: "OD-103-STD",
    priceAmountMinor: 1299,
    categorySlug: "outdoor-play",
  },
  {
    sku: "OD-104",
    name: "Garden Sandbox",
    slug: "garden-sandbox",
    variantSku: "OD-104-STD",
    priceAmountMinor: 8999,
    categorySlug: "outdoor-play",
  },
  {
    sku: "ED-201",
    name: "Alphabet Puzzle",
    slug: "alphabet-puzzle",
    variantSku: "ED-201-STD",
    priceAmountMinor: 1599,
    categorySlug: "educational-toys",
  },
  {
    sku: "ED-202",
    name: "Science Experiment Kit",
    slug: "science-experiment-kit",
    variantSku: "ED-202-STD",
    priceAmountMinor: 3499,
    categorySlug: "educational-toys",
  },
  {
    sku: "ED-203",
    name: "Coding Robot for Kids",
    slug: "coding-robot-for-kids",
    variantSku: "ED-203-STD",
    priceAmountMinor: 7999,
    categorySlug: "educational-toys",
  },
  {
    sku: "TG-301",
    name: "Kids Tablet",
    slug: "kids-tablet",
    variantSku: "TG-301-STD",
    priceAmountMinor: 9999,
    categorySlug: "tech-gadgets",
  },
  {
    sku: "TG-302",
    name: "Walkie Talkie Pair",
    slug: "walkie-talkie-pair",
    variantSku: "TG-302-STD",
    priceAmountMinor: 2999,
    categorySlug: "tech-gadgets",
  },
  {
    sku: "TG-303",
    name: "LED Drawing Tablet",
    slug: "led-drawing-tablet",
    variantSku: "TG-303-STD",
    priceAmountMinor: 1899,
    categorySlug: "tech-gadgets",
  },
];

interface CustomerSeed {
  readonly email: string;
  readonly name: string;
}

const CUSTOMER_SEEDS: readonly CustomerSeed[] = [
  { email: "amelia@morbeh.local", name: "Amelia Ortiz" },
  { email: "noah@morbeh.local", name: "Noah Whitfield" },
  { email: "sofia@morbeh.local", name: "Sofia Andersen" },
];

async function main(): Promise<void> {
  // Same shape as apps/runtime/src/seed.ts — every DatabaseConfig field passed explicitly (see
  // that file's comment for why a partial object cast with `as` breaks the connection string).
  const prisma = createPrismaClient({
    url: process.env.DATABASE_URL ?? "postgresql://lumo:lumo@localhost:5432/lumo",
    poolMax: Number(process.env.DATABASE_POOL_MAX ?? 10),
    connectTimeoutMs: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10_000),
    statementTimeoutMs: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 30_000),
    logQueries: false,
  });

  try {
    await prisma.$connect();
    logger.info("seed-demo: connected; seeding rich demo dataset", { tenantId: TENANT_ID });

    const clock = new SystemClock();
    const idGenerator = new CryptoIdGenerator();
    const serializer: EventSerializer = new JsonEventSerializer();
    const wiringDeps = { serializer, idGenerator, clock, prisma, tenantId: TENANT_ID };

    const catalog = wireCatalog(wiringDeps);
    const identity = wireIdentity(wiringDeps);
    const pricing = wirePricing(wiringDeps);
    const inventory = wireInventory(wiringDeps);
    const orders = wireOrders(wiringDeps).orders;
    const promotions = wirePromotions(wiringDeps).promotions;
    const reviews = wireReviews(wiringDeps).reviews;
    const content = wireContent(wiringDeps).content;

    // ---- Catalog: one brand (list + match by slug — no getBrandBySlug use-case exists, but the
    // tenant only ever has a handful of brands, so a single unpaged-ish list is cheap) ----
    interface BrandRecord {
      readonly id: IdLike;
      readonly slug: ValueLike;
    }
    const existingBrands = unwrap<{ items: readonly BrandRecord[] }>(
      await catalog.brands.list({ first: 100 }),
      "list brands",
    );
    const existingBrand = existingBrands.items.find((b) => b.slug.value === "morbeh-originals");
    let brandId: string;
    if (existingBrand !== undefined) {
      brandId = existingBrand.id.toString();
      logger.info("seed-demo: brand already exists, reusing", {
        brandId,
        slug: "morbeh-originals",
      });
    } else {
      const brand = unwrap<{ id: string }>(
        await catalog.brands.create({ name: "Morbeh Originals", slug: "morbeh-originals" }),
        "create brand",
      );
      brandId = brand.id;
      logger.info("seed-demo: created brand", { brandId, name: "Morbeh Originals" });
    }

    // ---- Catalog: 3 categories (same list + match-by-slug approach as the brand above) ----
    interface CategoryRecord {
      readonly id: IdLike;
      readonly slug: ValueLike;
    }
    const existingCategories = unwrap<{ items: readonly CategoryRecord[] }>(
      await catalog.categories.list({ first: 100 }),
      "list categories",
    );
    const categoriesBySlug = new Map<string, { id: string }>();
    for (const seed of CATEGORY_SEEDS) {
      const existing = existingCategories.items.find((c) => c.slug.value === seed.slug);
      if (existing !== undefined) {
        categoriesBySlug.set(seed.slug, { id: existing.id.toString() });
        logger.info("seed-demo: category already exists, reusing", {
          categoryId: existing.id.toString(),
          slug: seed.slug,
        });
        continue;
      }
      const category = unwrap<{ id: string }>(
        await catalog.categories.create({ name: seed.name, slug: seed.slug }),
        `create category "${seed.slug}"`,
      );
      categoriesBySlug.set(seed.slug, category);
      logger.info("seed-demo: created category", { categoryId: category.id, name: seed.name });
    }

    // ---- Catalog: 10 products spread across the 3 categories, branded + categorized + published.
    // `getBySlug` is a real use-case (the storefront's product-detail lookup), so products get an
    // exact natural-key check instead of list-and-filter. When a product already exists, the
    // brand/category/publish steps are assumed already done too (they always run together, in this
    // same block, on every path that creates the product) so they are not re-run. ----
    interface ProductRecord {
      readonly id: IdLike;
    }
    const products: Array<{ id: string; name: string; priceAmountMinor: number }> = [];
    for (const seed of PRODUCT_SEEDS) {
      const existing = unwrapOrNull<ProductRecord>(
        await catalog.products.getBySlug({ slug: seed.slug }),
        `look up product "${seed.slug}"`,
      );
      if (existing !== null) {
        const productId = existing.id.toString();
        products.push({ id: productId, name: seed.name, priceAmountMinor: seed.priceAmountMinor });
        logger.info("seed-demo: product already exists, reusing", { productId, sku: seed.sku });
        continue;
      }

      const category = categoriesBySlug.get(seed.categorySlug);
      if (category === undefined) {
        throw new Error(`Unknown category slug "${seed.categorySlug}" for product "${seed.sku}"`);
      }

      const created = unwrap<{ id: string }>(
        await catalog.products.create({
          sku: seed.sku,
          name: seed.name,
          slug: seed.slug,
          variants: [
            { sku: seed.variantSku, priceAmountMinor: seed.priceAmountMinor, currency: CURRENCY },
          ],
        }),
        `create product "${seed.sku}"`,
      );

      unwrap(
        await catalog.products.setBrand({ productId: created.id, brandId, tenantId: TENANT_ID }),
        `set brand on product "${seed.sku}"`,
      );
      unwrap(
        await catalog.products.assignCategories({
          productId: created.id,
          categoryIds: [category.id],
          tenantId: TENANT_ID,
        }),
        `assign categories on product "${seed.sku}"`,
      );
      unwrap(
        await catalog.products.publish({ productId: created.id, tenantId: TENANT_ID }),
        `publish product "${seed.sku}"`,
      );

      logger.info("seed-demo: created + published product", {
        productId: created.id,
        sku: seed.sku,
        name: seed.name,
        category: seed.categorySlug,
      });
      products.push({ id: created.id, name: seed.name, priceAmountMinor: seed.priceAmountMinor });
    }

    // ---- Pricing: one active price list, one published price per new product.
    //
    // GAP: `PriceListRepository` has no `findByName`/`list` at all (only `findById`, unexposed by
    // the composition root — see services/pricing/src/domain/price-list-repository.ts), so there is
    // no natural-key lookup for a price list, full stop. Per-product idempotency is still real,
    // though: `priceRepository.findPublishedByProduct` IS exposed (WiredPricing.priceRepository,
    // the same cross-context-read convention as `warehouseRepository`/`inventoryItemRepository`
    // below), and a `Price` carries its own `priceListId`. So: check every product for an existing
    // published price first; if any is found, recover its `priceListId` and reuse it for whatever
    // products still need one, and skip `priceLists.create` entirely. A new price list is only
    // created on a genuine first run (no product has a published price yet). Residual gap: if a
    // *prior* partial run created a price list but published zero prices under it, this can still
    // create a second, orphaned "Demo Retail" price list — undetectable without the missing
    // lookup. Diagnosed live on 2026-09-04: not this run's situation (all 10 demo prices already
    // existed), so untested here. ----
    let priceListId: string | null = null;
    const productsNeedingPrice: typeof products = [];
    for (const product of products) {
      const existingPrices = await pricing.priceRepository.findPublishedByProduct(
        product.id,
        CURRENCY,
      );
      if (existingPrices.length > 0) {
        priceListId = priceListId ?? existingPrices[0]!.priceListId;
        logger.info("seed-demo: published price already exists for product, skipping", {
          productId: product.id,
          priceListId: existingPrices[0]!.priceListId,
        });
      } else {
        productsNeedingPrice.push(product);
      }
    }

    if (productsNeedingPrice.length > 0) {
      if (priceListId === null) {
        const priceList = unwrap<{ id: string }>(
          await pricing.priceLists.create({ name: "Demo Retail", currency: CURRENCY }),
          "create price list",
        );
        unwrap(
          await pricing.priceLists.activate({ priceListId: priceList.id }),
          "activate price list",
        );
        priceListId = priceList.id;
        logger.info("seed-demo: created + activated price list", {
          priceListId,
          name: "Demo Retail",
        });
      } else {
        logger.info("seed-demo: reusing price list id recovered from an existing published price", {
          priceListId,
        });
      }

      for (const product of productsNeedingPrice) {
        const price = unwrap<{ id: string }>(
          await pricing.prices.create({
            priceListId,
            productId: product.id,
            amountMinor: product.priceAmountMinor,
            currency: CURRENCY,
          }),
          `create price for product "${product.id}"`,
        );
        unwrap(
          await pricing.prices.publish({ priceId: price.id }),
          `publish price for product "${product.id}"`,
        );
        logger.info("seed-demo: created + published price", {
          productId: product.id,
          priceId: price.id,
          amountMinor: product.priceAmountMinor,
          currency: CURRENCY,
        });
      }
    } else {
      logger.info(
        "seed-demo: every demo product already has a published price, skipping pricing step",
      );
    }

    // ---- Inventory: one warehouse, stocked with every new product. `findByCode` is the
    // registration natural key, exposed directly via `warehouseRepository` (the same cross-context
    // read convention `WiredInventory` documents for Checkout's adapters) — a real read, not a raw
    // Prisma query. ----
    const existingWarehouse = await inventory.warehouseRepository.findByCode("DEMO");
    let warehouseId: string;
    if (existingWarehouse !== null) {
      warehouseId = existingWarehouse.id.toString();
      logger.info("seed-demo: warehouse already exists, reusing", { warehouseId, code: "DEMO" });
    } else {
      const warehouse = unwrap<{ warehouseId: string }>(
        await inventory.warehouse.register({ code: "DEMO", name: "Demo Warehouse" }),
        "register warehouse",
      );
      warehouseId = warehouse.warehouseId;
      logger.info("seed-demo: registered warehouse", {
        warehouseId,
        code: "DEMO",
        name: "Demo Warehouse",
      });
    }

    for (const product of products) {
      // `findByProductAndWarehouse` is the item's natural key (also exposed directly via
      // `inventoryItemRepository`, same convention as `warehouseRepository` above).
      const existingItem = await inventory.inventoryItemRepository.findByProductAndWarehouse(
        product.id,
        warehouseId,
      );
      if (existingItem !== null && existingItem.stockLevel.onHand > 0) {
        logger.info("seed-demo: stock already received for product, skipping", {
          productId: product.id,
          warehouseId,
          onHand: existingItem.stockLevel.onHand,
        });
        continue;
      }
      const received = unwrap<{ available: number }>(
        await inventory.inventory.receive({
          productId: product.id,
          warehouseId,
          quantity: 50,
        }),
        `receive stock for product "${product.id}"`,
      );
      logger.info("seed-demo: received stock", {
        productId: product.id,
        warehouseId,
        available: received.available,
      });
    }

    // ---- Identity: 3 demo customers, one per demo order. `listCustomers({ search })` matches
    // name/email by case-insensitive substring (see PrismaCustomerRepository.list); a full email is
    // specific enough to treat as an exact match. ----
    interface CustomerRecord {
      readonly id: IdLike;
      readonly email: ValueLike;
    }
    const customers: Array<{ customerId: string; email: string }> = [];
    for (const seed of CUSTOMER_SEEDS) {
      const found = unwrap<{ items: readonly CustomerRecord[] }>(
        await identity.customers.listCustomers({
          search: seed.email,
          first: 5,
          tenantId: TENANT_ID,
        }),
        `look up customer "${seed.email}"`,
      );
      const existing = found.items.find((c) => c.email.value === seed.email);
      if (existing !== undefined) {
        const customerId = existing.id.toString();
        customers.push({ customerId, email: seed.email });
        logger.info("seed-demo: customer already exists, reusing", {
          customerId,
          email: seed.email,
        });
        continue;
      }
      const customer = unwrap<{ customerId: string }>(
        await identity.customers.register({
          email: seed.email,
          name: seed.name,
          tenantId: TENANT_ID,
        }),
        `register customer "${seed.email}"`,
      );
      customers.push({ customerId: customer.customerId, email: seed.email });
      logger.info("seed-demo: registered customer", {
        customerId: customer.customerId,
        email: seed.email,
      });
    }

    // ---- Orders: 3 orders in different lifecycle states (placed -> paid -> refunded path).
    //
    // GAP: orders have no natural key at all (order number is server-generated, not something this
    // script chooses) — `OrderRepository`'s only lookups are `findById` and a free-text `search`
    // over order number, neither of which this script has a value for ahead of creation. So exact
    // per-order idempotency is not possible through any exposed read use-case. The check below is
    // coarser but sound for this script's actual shape: `seed.ts` never creates orders, so ANY order
    // existing for this tenant can only have come from this block already having run. On a re-run
    // where it already did, skip the whole block rather than risk placing 3 more. ----
    interface OrderRecord {
      readonly id: IdLike;
    }
    const existingOrders = unwrap<{ items: readonly OrderRecord[] }>(
      await orders.listOrders({ first: 1 }),
      "list orders",
    );
    if (existingOrders.items.length > 0) {
      logger.info(
        "seed-demo: orders already exist for this tenant, skipping order creation (orders have no natural key to dedupe individually — see seed-demo.ts comment)",
      );
    } else {
      const shippingAddress = {
        line1: "1 Demo Way",
        city: "Springfield",
        postalCode: "00000",
        country: "US",
      };

      // Order 1: placed only — awaiting payment.
      const order1 = unwrap<{ orderId: string; orderNumber: string }>(
        await orders.place({
          customerRef: customers[0]!.customerId,
          currency: CURRENCY,
          items: [
            {
              productId: products[0]!.id,
              name: products[0]!.name,
              unitPriceAmountMinor: products[0]!.priceAmountMinor,
              quantity: 1,
            },
          ],
          shippingAddress,
        }),
        "place order 1",
      );
      logger.info("seed-demo: order placed (status=placed)", {
        orderId: order1.orderId,
        orderNumber: order1.orderNumber,
      });

      // Order 2: placed -> paid.
      const order2 = unwrap<{ orderId: string; orderNumber: string }>(
        await orders.place({
          customerRef: customers[1]!.customerId,
          currency: CURRENCY,
          items: [
            {
              productId: products[1]!.id,
              name: products[1]!.name,
              unitPriceAmountMinor: products[1]!.priceAmountMinor,
              quantity: 2,
            },
          ],
          shippingAddress,
        }),
        "place order 2",
      );
      unwrap(
        await orders.markPaid({
          orderId: order2.orderId,
          paymentRef: `seed-payment-${order2.orderId}`,
        }),
        "mark order 2 paid",
      );
      logger.info("seed-demo: order placed + paid (status=paid)", {
        orderId: order2.orderId,
        orderNumber: order2.orderNumber,
      });

      // Order 3: placed -> paid -> refunded.
      const order3 = unwrap<{ orderId: string; orderNumber: string }>(
        await orders.place({
          customerRef: customers[2]!.customerId,
          currency: CURRENCY,
          items: [
            {
              productId: products[2]!.id,
              name: products[2]!.name,
              unitPriceAmountMinor: products[2]!.priceAmountMinor,
              quantity: 1,
            },
            {
              productId: products[3]!.id,
              name: products[3]!.name,
              unitPriceAmountMinor: products[3]!.priceAmountMinor,
              quantity: 1,
            },
          ],
          shippingAddress,
        }),
        "place order 3",
      );
      unwrap(
        await orders.markPaid({
          orderId: order3.orderId,
          paymentRef: `seed-payment-${order3.orderId}`,
        }),
        "mark order 3 paid",
      );
      unwrap(await orders.refund({ orderId: order3.orderId }), "refund order 3");
      logger.info("seed-demo: order placed + paid + refunded (status=refunded)", {
        orderId: order3.orderId,
        orderNumber: order3.orderNumber,
      });
    }

    // ---- Promotions: one active, cart-wide percentage discount (list + match by name — no
    // getPromotionByName use-case exists, but the tenant only ever has a handful of promotions).
    //
    // Wrapped defensively: `PromotionMapper.toDomain` throws on ANY row whose persisted `reward`
    // JSON fails validation, and `PrismaPromotionRepository.list`/`findById` apply that mapper via
    // a bare `.map()` over the whole page — so a single corrupt row poisons every read, not just
    // the one row (a real, separate bug from the `reward.value`-dropping mapper bug already fixed
    // in promotion.mapper.ts; this repo has no per-row error isolation at all). Diagnosed live on
    // 2026-09-04: exactly this happened to a leftover "Demo 15% Off Everything" row from an earlier
    // failed run — its persisted `reward` is `{"type":"percentage"}` with NO `value`, status
    // "draft" (its `advance` to "active" evidently never completed before that run crashed). There
    // is no use-case to edit a promotion's reward once created, and repairing the row would require
    // a raw SQL UPDATE outside the "no raw SQL" seed-tooling convention this script otherwise
    // follows strictly — flagged in the report instead of silently patched. So: catch the failure,
    // skip promotion handling for this run rather than crashing the whole seed, and leave
    // `promotionId` null. NOTE: this means the promotions step is not actually idempotent while
    // that row remains corrupt — every re-run will hit this same catch (list() can never succeed)
    // and this whole step is skipped every time, not just once. It does *not* create a duplicate,
    // but it also never creates or activates the demo promotion until the underlying row is fixed
    // out of band. ----
    let promotionId: string | null = null;
    try {
      interface PromotionRecord {
        readonly id: IdLike;
        readonly name: string;
        readonly status: ValueLike;
      }
      const existingPromotions = unwrap<{ items: readonly PromotionRecord[] }>(
        await promotions.list({ first: 100 }),
        "list promotions",
      );
      const existingPromotion = existingPromotions.items.find(
        (p) => p.name === "Demo 15% Off Everything",
      );
      if (existingPromotion !== undefined) {
        promotionId = existingPromotion.id.toString();
        if (existingPromotion.status.value === "active") {
          logger.info("seed-demo: promotion already exists and is active, reusing", {
            promotionId,
          });
        } else {
          unwrap(
            await promotions.advance({ promotionId, toStatus: "active" }),
            "activate promotion",
          );
          logger.info("seed-demo: promotion already existed but was not active, activated", {
            promotionId,
            previousStatus: existingPromotion.status.value,
          });
        }
      } else {
        const promotion = unwrap<{ promotionId: string; status: string }>(
          await promotions.create({
            name: "Demo 15% Off Everything",
            ruleType: "automatic",
            scope: "cart",
            targetRefs: [],
            rewardType: "percentage",
            rewardValue: 15,
            stackable: false,
            priority: 1,
            startsAt: clock.now(),
          }),
          "create promotion",
        );
        unwrap(
          await promotions.advance({ promotionId: promotion.promotionId, toStatus: "active" }),
          "activate promotion",
        );
        promotionId = promotion.promotionId;
        logger.info("seed-demo: created + activated promotion", {
          promotionId,
          name: "Demo 15% Off Everything",
        });
      }
    } catch (error: unknown) {
      // Narrow on purpose: only the known "a persisted row fails domain validation" failure mode
      // (PromotionMapper.toDomain's own error message, see the comment above) is safe to swallow
      // and continue past. Anything else — a network blip, a real regression in this block — should
      // fail the script loudly instead of being silently mistaken for the known corrupt-row issue.
      const isKnownCorruptRowFailure =
        error instanceof Error && error.message.includes("Corrupt promotion row");
      if (!isKnownCorruptRowFailure) throw error;
      logger.error(
        "seed-demo: promotions step failed (likely the corrupt legacy 'Demo 15% Off Everything' row — see seed-demo.ts comment above); skipping promotions, continuing with reviews + content",
        { error: String(error) },
      );
    }

    // ---- Reviews: 3 published reviews across the new products. `listByProduct` is a real
    // use-case; filtering its results by `customerRef` reproduces
    // `ReviewRepository.findByCustomerAndProduct`'s natural-key check (that repository method
    // exists but is not wired to any use-case/controller, so it is not reachable from here). ----
    interface ReviewRecord {
      readonly id: IdLike;
      readonly customerRef: string;
      readonly status: ValueLike;
    }
    const reviewSeeds = [
      {
        product: products[0]!,
        customer: customers[0]!,
        rating: 5,
        bodyText: "My kids love it. Sturdy and well made, worth every penny.",
      },
      {
        product: products[4]!,
        customer: customers[1]!,
        rating: 4,
        bodyText: "Great educational value, kept my daughter engaged for hours.",
      },
      {
        product: products[7]!,
        customer: customers[2]!,
        rating: 5,
        bodyText: "Perfect first tablet for a 6 year old. Highly recommend.",
      },
    ];
    for (const seed of reviewSeeds) {
      const forProduct = unwrap<{ items: readonly ReviewRecord[] }>(
        await reviews.listByProduct({ productRef: seed.product.id, first: 100 }),
        `look up reviews for product "${seed.product.id}"`,
      );
      const existing = forProduct.items.find((r) => r.customerRef === seed.customer.customerId);
      if (existing !== undefined) {
        const reviewId = existing.id.toString();
        if (existing.status.value === "published") {
          logger.info("seed-demo: review already exists and is published, reusing", {
            reviewId,
            productId: seed.product.id,
          });
        } else {
          unwrap(
            await reviews.advance({ reviewId, toStatus: "published" }),
            `publish review "${reviewId}"`,
          );
          logger.info("seed-demo: review already existed but was not published, published now", {
            reviewId,
            productId: seed.product.id,
            previousStatus: existing.status.value,
          });
        }
        continue;
      }

      const review = unwrap<{ reviewId: string }>(
        await reviews.create({
          productRef: seed.product.id,
          customerRef: seed.customer.customerId,
          rating: seed.rating,
          bodyText: seed.bodyText,
        }),
        `create review for product "${seed.product.id}"`,
      );
      unwrap(
        await reviews.advance({ reviewId: review.reviewId, toStatus: "published" }),
        `publish review "${review.reviewId}"`,
      );
      logger.info("seed-demo: created + published review", {
        reviewId: review.reviewId,
        productId: seed.product.id,
        rating: seed.rating,
      });
    }

    // ---- Content: 2 published content pages. `ContentBlockRepository.findByName` exists (the
    // natural key) but, like Reviews' `findByCustomerAndProduct`, is not wired to any
    // use-case/controller and `WiredContent` does not expose the repository directly — so list +
    // match-by-name (the same approach used for brands/categories/promotions above) is what is
    // actually reachable here. ----
    interface ContentRecord {
      readonly id: IdLike;
      readonly name: string;
      readonly status: ValueLike;
    }
    const existingContent = unwrap<{ items: readonly ContentRecord[] }>(
      await content.list({ first: 100 }),
      "list content blocks",
    );
    const contentSeeds = [
      {
        name: "homepage-hero",
        blockType: "hero",
        format: "html" as const,
        content:
          "<section><h1>Welcome to Morbeh Toys</h1><p>Playful gear for curious kids.</p></section>",
      },
      {
        name: "about-us",
        blockType: "page",
        format: "markdown" as const,
        content: "# About Morbeh\n\nWe build toys that make screen-free play irresistible.",
      },
    ];
    for (const seed of contentSeeds) {
      const existing = existingContent.items.find((c) => c.name === seed.name);
      if (existing !== undefined) {
        const contentBlockId = existing.id.toString();
        if (existing.status.value === "published") {
          logger.info("seed-demo: content block already exists and is published, reusing", {
            contentBlockId,
            name: seed.name,
          });
        } else {
          unwrap(
            await content.advance({ contentBlockId, toStatus: "published" }),
            `publish content block "${seed.name}"`,
          );
          logger.info(
            "seed-demo: content block already existed but was not published, published now",
            {
              contentBlockId,
              name: seed.name,
              previousStatus: existing.status.value,
            },
          );
        }
        continue;
      }

      const block = unwrap<{ contentBlockId: string }>(
        await content.create({
          name: seed.name,
          blockType: seed.blockType,
          format: seed.format,
          content: seed.content,
        }),
        `create content block "${seed.name}"`,
      );
      unwrap(
        await content.advance({ contentBlockId: block.contentBlockId, toStatus: "published" }),
        `publish content block "${seed.name}"`,
      );
      logger.info("seed-demo: created + published content block", {
        contentBlockId: block.contentBlockId,
        name: seed.name,
      });
    }

    logger.info("seed-demo: done", {
      tenantId: TENANT_ID,
      brandId,
      categories: [...categoriesBySlug.values()].map((c) => c.id),
      products: products.map((p) => ({ id: p.id, name: p.name })),
      priceListId,
      warehouseId,
      customers: customers.map((c) => c.customerId),
      promotionId,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  logger.error("seed-demo failed", { error: String(error) });
  process.exitCode = 1;
});
