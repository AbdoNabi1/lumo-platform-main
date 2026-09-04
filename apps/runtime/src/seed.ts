import { SystemClock } from "@platform/clock";
import { createPrismaClient } from "@platform/db";
import { JsonEventSerializer, type EventSerializer } from "@platform/domain-events";
import { CryptoIdGenerator } from "@platform/id";
import { wireCatalog } from "@platform/catalog";
import { wireIdentity } from "@platform/identity";
import { wireInventory } from "@platform/inventory";
import { wirePricing } from "@platform/pricing";
import { logger } from "@platform/utils";

/**
 * Minimal local-development demo dataset (Phase 8). Wires the same bounded-context composition
 * roots the runtime uses (`wireCatalog`/`wireIdentity`/`wirePricing`/`wireInventory`) against real
 * Postgres — no raw Prisma inserts, no new business logic. `TENANT_ID` matches
 * `TENANT_DEFAULT_ID`'s default ("tenant-local", see apps/runtime/src/config.ts and .env.example)
 * so the runtime API's default tenant resolves straight to this data.
 *
 * Lives in `apps/runtime` (not `packages/db`, which is invoked via `prisma db seed` per
 * `packages/db/package.json`'s `prisma.seed` config pointing here) because a foundational package
 * must never depend on business-context packages — that dependency direction created a real
 * circular package graph (`@platform/db` -> catalog/identity/pricing/inventory -> `@platform/db`)
 * that broke turbo's build graph. `apps/runtime` already legitimately depends on every context.
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

interface ProductSeed {
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly variantSku: string;
  readonly priceAmountMinor: number;
}

const PRODUCT_SEEDS: readonly ProductSeed[] = [
  {
    sku: "WB-001",
    name: "Wooden Building Blocks",
    slug: "wooden-building-blocks",
    variantSku: "WB-001-STD",
    priceAmountMinor: 2999,
  },
  {
    sku: "PT-002",
    name: "Plush Teddy Bear",
    slug: "plush-teddy-bear",
    variantSku: "PT-002-STD",
    priceAmountMinor: 1999,
  },
  {
    sku: "RC-003",
    name: "Remote Control Car",
    slug: "remote-control-car",
    variantSku: "RC-003-STD",
    priceAmountMinor: 4999,
  },
];

async function main(): Promise<void> {
  // Every DatabaseConfig field is passed explicitly: `buildDatasourceUrl`
  // (packages/db/src/client.ts) reads `poolMax` and `connectTimeoutMs` unconditionally, so a
  // partial object cast with `as` produced the literal query string
  // `?connection_limit=undefined&connect_timeout=NaN`, which Prisma rejects at connect time with
  // "The provided arguments are not supported in database URL" — the seed could never run.
  const prisma = createPrismaClient({
    url: process.env.DATABASE_URL ?? "postgresql://lumo:lumo@localhost:5432/lumo",
    poolMax: Number(process.env.DATABASE_POOL_MAX ?? 10),
    connectTimeoutMs: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10_000),
    statementTimeoutMs: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 30_000),
    logQueries: false,
  });

  try {
    await prisma.$connect();
    logger.info("seed: connected; seeding minimal demo dataset", { tenantId: TENANT_ID });

    const clock = new SystemClock();
    const idGenerator = new CryptoIdGenerator();
    const serializer: EventSerializer = new JsonEventSerializer();
    const wiringDeps = { serializer, idGenerator, clock, prisma, tenantId: TENANT_ID };

    const catalog = wireCatalog(wiringDeps);
    const identity = wireIdentity(wiringDeps);
    const pricing = wirePricing(wiringDeps);
    const inventory = wireInventory(wiringDeps);

    // ---- Catalog: brand + category ----
    const brand = unwrap<{ id: string }>(
      await catalog.brands.create({ name: "Acme Toys", slug: "acme-toys" }),
      "create brand",
    );
    logger.info("seed: created brand", { brandId: brand.id, name: "Acme Toys" });

    const category = unwrap<{ id: string }>(
      await catalog.categories.create({ name: "Toys", slug: "toys" }),
      "create category",
    );
    logger.info("seed: created category", { categoryId: category.id, name: "Toys" });

    // ---- Catalog: products (each with one variant), branded + categorized + published ----
    const products: Array<{ id: string; name: string; priceAmountMinor: number }> = [];
    for (const seed of PRODUCT_SEEDS) {
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
        await catalog.products.setBrand({ productId: created.id, brandId: brand.id }),
        `set brand on product "${seed.sku}"`,
      );
      unwrap(
        await catalog.products.assignCategories({
          productId: created.id,
          categoryIds: [category.id],
        }),
        `assign categories on product "${seed.sku}"`,
      );
      unwrap(
        await catalog.products.publish({ productId: created.id }),
        `publish product "${seed.sku}"`,
      );

      logger.info("seed: created + published product", {
        productId: created.id,
        sku: seed.sku,
        name: seed.name,
      });
      products.push({ id: created.id, name: seed.name, priceAmountMinor: seed.priceAmountMinor });
    }

    // ---- Catalog: one collection containing every seeded product ----
    const collection = unwrap<{ id: string }>(
      await catalog.collections.create({ name: "Featured Toys", slug: "featured-toys" }),
      "create collection",
    );
    for (const product of products) {
      unwrap(
        await catalog.collections.addProduct({
          collectionId: collection.id,
          productId: product.id,
        }),
        `add product "${product.id}" to collection`,
      );
    }
    unwrap(
      await catalog.collections.publish({ collectionId: collection.id }),
      "publish collection",
    );
    logger.info("seed: created + published collection", {
      collectionId: collection.id,
      name: "Featured Toys",
      productCount: products.length,
    });

    // ---- Identity: one demo customer ----
    const customer = unwrap<{ customerId: string }>(
      await identity.customers.register({ email: "demo@lumo.local", name: "Demo Customer" }),
      "register customer",
    );
    logger.info("seed: registered customer", {
      customerId: customer.customerId,
      email: "demo@lumo.local",
    });

    // ---- Pricing: one active price list, one published price per product ----
    const priceList = unwrap<{ id: string }>(
      await pricing.priceLists.create({ name: "Default Retail", currency: CURRENCY }),
      "create price list",
    );
    unwrap(await pricing.priceLists.activate({ priceListId: priceList.id }), "activate price list");
    logger.info("seed: created + activated price list", {
      priceListId: priceList.id,
      name: "Default Retail",
    });

    for (const product of products) {
      const price = unwrap<{ id: string }>(
        await pricing.prices.create({
          priceListId: priceList.id,
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
      logger.info("seed: created + published price", {
        productId: product.id,
        priceId: price.id,
        amountMinor: product.priceAmountMinor,
        currency: CURRENCY,
      });
    }

    // ---- Inventory: one warehouse, stocked with every product ----
    const warehouse = unwrap<{ warehouseId: string }>(
      await inventory.warehouse.register({ code: "MAIN", name: "Main Warehouse" }),
      "register warehouse",
    );
    logger.info("seed: registered warehouse", {
      warehouseId: warehouse.warehouseId,
      code: "MAIN",
      name: "Main Warehouse",
    });

    for (const product of products) {
      const received = unwrap<{ available: number }>(
        await inventory.inventory.receive({
          productId: product.id,
          warehouseId: warehouse.warehouseId,
          quantity: 100,
        }),
        `receive stock for product "${product.id}"`,
      );
      logger.info("seed: received stock", {
        productId: product.id,
        warehouseId: warehouse.warehouseId,
        available: received.available,
      });
    }

    logger.info("seed: done", {
      tenantId: TENANT_ID,
      brandId: brand.id,
      categoryId: category.id,
      products: products.map((p) => ({ id: p.id, name: p.name })),
      collectionId: collection.id,
      customerId: customer.customerId,
      priceListId: priceList.id,
      warehouseId: warehouse.warehouseId,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  logger.error("seed failed", { error: String(error) });
  process.exitCode = 1;
});
