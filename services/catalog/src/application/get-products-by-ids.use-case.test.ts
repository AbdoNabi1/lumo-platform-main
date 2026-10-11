import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { TransactionClient } from "@platform/db";
import { Product } from "../domain/product";
import { Sku } from "../domain/value-objects/sku";
import { Slug } from "../domain/value-objects/slug";
import { Variant } from "../domain/variant";
import { CatalogEventTranslator } from "../infrastructure/catalog-event-translator";
import { InMemoryProductRepository } from "../infrastructure/in-memory-product-repository";
import { PrismaProductRepository } from "../infrastructure/prisma-catalog-repositories";
import { GetProductsByIds } from "./get-products-by-ids.use-case";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function product(id: string, skuValue: string): Product {
  return Product.create(
    UniqueEntityId.from(id),
    {
      sku: must(Sku.create(skuValue)),
      name: skuValue,
      slug: must(Slug.create(skuValue.toLowerCase())),
      variants: [
        Variant.create(
          UniqueEntityId.from(`${id}-v`),
          must(Sku.create(`${skuValue}-V1`)),
          must(Money.create(1000, "USD")),
        ),
      ],
    },
    "evt-0",
    new Date(0),
  );
}

describe("GetProductsByIds (Plan 2C-3, the no-N+1 product read)", () => {
  function repo() {
    const outbox = new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new CatalogEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "catalog",
    });
    let n = 0;
    return new InMemoryProductRepository({
      outbox,
      context: rootEventContext({ generate: () => `e-${(n += 1)}` }),
    });
  }

  it("returns the tenant's products among the ids, skipping unknown, deleted and foreign ones", async () => {
    const products = repo();
    const a = product("p-a", "A");
    const b = product("p-b", "B");
    const gone = product("p-gone", "GONE");
    gone.delete("evt-d", new Date(0));
    await products.save(a, "t1");
    await products.save(b, "t2");
    await products.save(gone, "t1");

    const result = await new GetProductsByIds({ products }).execute({
      ids: ["p-a", "p-b", "p-gone", "nope"],
      tenantId: "t1",
    });

    expect(result.ok && result.value.map((p) => p.id.toString())).toEqual(["p-a"]);
  });

  it("answers an empty list for no ids", async () => {
    const result = await new GetProductsByIds({ products: repo() }).execute({
      ids: [],
      tenantId: "t1",
    });
    expect(result.ok && result.value).toEqual([]);
  });
});

describe("PrismaProductRepository.findByIds", () => {
  const UUID_A = "11111111-1111-4111-8111-111111111111";

  it("makes ONE tenant-scoped, non-deleted read, and only asks for well-formed ids", async () => {
    const calls: unknown[] = [];
    const client = {
      product: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [];
        },
      },
    } as unknown as TransactionClient;
    const repo = new PrismaProductRepository({} as never);

    await repo.findByIds([UUID_A, "not-a-uuid", UUID_A], "t1", client);

    expect(calls).toEqual([
      {
        where: { tenantId: "t1", deletedAt: null, id: { in: [UUID_A] } },
        include: { variants: true },
      },
    ]);
  });

  it("makes no read at all when no id is well-formed", async () => {
    const calls: unknown[] = [];
    const client = {
      product: { findMany: async (args: unknown) => void calls.push(args) },
    } as unknown as TransactionClient;
    const repo = new PrismaProductRepository({} as never);
    expect(await repo.findByIds(["x"], "t1", client)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
