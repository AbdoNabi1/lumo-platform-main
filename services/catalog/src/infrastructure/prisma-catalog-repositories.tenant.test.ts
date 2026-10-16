import { describe, expect, it } from "vitest";
import type { TransactionClient } from "@platform/db";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Product } from "../domain/product";
import { Sku } from "../domain/value-objects/sku";
import { Slug } from "../domain/value-objects/slug";
import { Variant } from "../domain/variant";
import { CatalogEventTranslator } from "./catalog-event-translator";
import { PrismaProductRepository } from "./prisma-catalog-repositories";

/**
 * G-76 — CLOSED. `productVariant.upsert({ where: { id: row.id }, ... })` addressed the row by id
 * alone; variant ids are generated on the tenant-scoped aggregate so this was not reachable through
 * any route today, but an id collision would have let one tenant's save overwrite another tenant's
 * variant. Fixed the same way as the sibling refund gap (G-76): scope the update to
 * `(id, tenantId)`, and only `create` when that scoped update matches nothing — a collision then
 * fails the row's own primary-key constraint instead of crossing tenants.
 */

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("test setup: invalid VO");
  return r.value;
}

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function productWithVariantId(
  nextId: () => string,
  variantId: string,
  skuValue: string,
  slugValue: string,
): Product {
  const variant = Variant.create(
    UniqueEntityId.from(variantId),
    must(Sku.create(`${skuValue}-V1`)),
    must(Money.create(1999, "USD")),
  );
  return Product.create(
    UniqueEntityId.from(nextId()),
    {
      sku: must(Sku.create(skuValue)),
      name: skuValue,
      slug: must(Slug.create(slugValue)),
      variants: [variant],
    },
    nextId(),
    new Date(0),
  );
}

interface VariantRow {
  id: string;
  tenantId: string;
  productId: string;
  sku: string;
  [k: string]: unknown;
}

function fakeTx() {
  const variants: VariantRow[] = [];
  const client = {
    product: {
      create: async () => undefined,
      updateMany: async () => ({ count: 1 }),
    },
    productVariant: {
      deleteMany: async () => ({ count: 0 }),
      // Matches only on the keys actually PRESENT in `where` — a real Prisma `updateMany` places no
      // restriction on a field it is never told to filter by, so an omitted `tenantId` must match
      // every tenant's row, not none of them.
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const matches = variants.filter((v) =>
          Object.entries(where).every(([k, val]) => (v as Record<string, unknown>)[k] === val),
        );
        for (const row of matches) Object.assign(row, data);
        return { count: matches.length };
      },
      create: async ({ data }: { data: VariantRow }) => {
        if (variants.some((v) => v.id === data.id)) {
          throw new Error("Unique constraint failed on the fields: (`id`)");
        }
        variants.push({ ...data });
      },
    },
  };
  return { client: client as unknown as TransactionClient, variants };
}

function wireRepo(nextId: () => string) {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new CatalogEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-09-26T00:00:00.000Z") },
    producer: "catalog",
  });
  return new PrismaProductRepository({
    prisma: {} as never,
    outbox: outbox as never,
    context: rootEventContext({ generate: nextId }),
  });
}

describe("PrismaProductRepository variant save — tenant isolation (G-76, closed)", () => {
  it("refuses rather than overwriting another tenant's variant when a variant id collides", async () => {
    const { client, variants } = fakeTx();
    variants.push({
      id: "variant-shared",
      tenantId: "tenant-a",
      productId: "product-a",
      sku: "SKU-A-V1",
      priceAmountMinor: 1999,
      currency: "USD",
      selection: null,
      mediaRef: null,
    });

    const nextId = monotonicIds();
    const repo = wireRepo(nextId);
    const productB = productWithVariantId(nextId, "variant-shared", "SKU-B", "sku-b-slug");

    await expect(repo.save(productB, "tenant-b", client)).rejects.toThrow(/unique constraint/i);

    const tenantARow = variants.find((v) => v.id === "variant-shared" && v.tenantId === "tenant-a");
    expect(tenantARow?.sku).toBe("SKU-A-V1");
    expect(variants.filter((v) => v.id === "variant-shared")).toHaveLength(1);
  });

  it("creates a variant it owns without touching any other row", async () => {
    const { client, variants } = fakeTx();
    const nextId = monotonicIds();
    const repo = wireRepo(nextId);
    const productA = productWithVariantId(nextId, "variant-a", "SKU-A", "sku-a-slug");

    await repo.save(productA, "tenant-a", client);

    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ id: "variant-a", tenantId: "tenant-a", sku: "SKU-A-V1" });
  });
});
