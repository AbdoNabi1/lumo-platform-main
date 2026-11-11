import { beforeEach, describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Product } from "../domain/product";
import { Sku } from "../domain/value-objects/sku";
import { Slug } from "../domain/value-objects/slug";
import { Variant } from "../domain/variant";
import { CatalogEventTranslator } from "../infrastructure/catalog-event-translator";
import { InMemoryProductRepository } from "../infrastructure/in-memory-product-repository";
import { ListNewestProducts } from "./list-newest-products.use-case";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

type Fixture = "published" | "draft" | "unlisted" | "deleted";

function product(id: string, state: Fixture): Product {
  const sku = id.toUpperCase();
  const created = Product.create(
    UniqueEntityId.from(id),
    {
      sku: must(Sku.create(sku)),
      name: sku,
      slug: must(Slug.create(id)),
      variants: [
        Variant.create(
          UniqueEntityId.from(`${id}-v`),
          must(Sku.create(`${sku}-V1`)),
          must(Money.create(1000, "USD")),
        ),
      ],
    },
    "evt-0",
    new Date(0),
  );
  if (state !== "draft") created.publish("evt-p", new Date(0));
  if (state === "unlisted") created.unlist("evt-u", new Date(0));
  if (state === "deleted") created.delete("evt-d", new Date(0));
  return created;
}

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

const ids = (r: { ok: boolean; value?: readonly Product[] }) =>
  (r.value ?? []).map((p) => p.id.toString());

describe("ListNewestProducts (Online Store Part 3, the default homepage's newest products)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  // Created in id order: 1 published, 2 draft, 3 published, 4 unlisted, 5 published, 6 deleted-published.
  async function seeded() {
    const products = repo();
    const rows: readonly [string, Fixture][] = [
      ["p-1", "published"],
      ["p-2", "draft"],
      ["p-3", "published"],
      ["p-4", "unlisted"],
      ["p-5", "published"],
      ["p-6", "deleted"],
    ];
    for (const [id, state] of rows) await products.save(product(id, state), "t1");
    return products;
  }

  it("limit 2 gives the two highest-id published products, newest first", async () => {
    const products = await seeded();
    const result = await new ListNewestProducts({ products }).execute({ limit: 2, tenantId: "t1" });
    expect(result.ok).toBe(true);
    expect(ids(result as never)).toEqual(["p-5", "p-3"]);
  });

  it("never lists drafts, unlisted, deleted or another tenant's products", async () => {
    const products = await seeded();
    await products.save(product("p-9", "published"), "t2");
    const result = await new ListNewestProducts({ products }).execute({
      limit: 50,
      tenantId: "t1",
    });
    expect(ids(result as never)).toEqual(["p-5", "p-3", "p-1"]);
    const other = await new ListNewestProducts({ products }).execute({ limit: 50, tenantId: "t2" });
    expect(ids(other as never)).toEqual(["p-9"]);
  });

  it("clamps limit 0 to 1 and limit 500 to 50", async () => {
    const products = repo();
    for (let i = 1; i <= 60; i += 1) {
      await products.save(product(`p-${String(i).padStart(3, "0")}`, "published"), "t1");
    }
    const useCase = new ListNewestProducts({ products });
    const one = await useCase.execute({ limit: 0, tenantId: "t1" });
    const many = await useCase.execute({ limit: 500, tenantId: "t1" });
    expect(ids(one as never)).toEqual(["p-060"]);
    expect(ids(many as never)).toHaveLength(50);
  });
});
