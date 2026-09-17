import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Product } from "../domain/product";
import { Sku } from "../domain/value-objects/sku";
import { Slug } from "../domain/value-objects/slug";
import { Variant } from "../domain/variant";
import { CatalogEventTranslator } from "./catalog-event-translator";
import { InMemoryProductRepository } from "./in-memory-product-repository";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("test setup: invalid VO");
  return r.value;
}

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new CatalogEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "catalog",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemoryProductRepository({ outbox, context });
  return { repository, nextId };
}

function product(nextId: () => string, skuValue: string, slugValue: string): Product {
  const variant = Variant.create(
    UniqueEntityId.from(nextId()),
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

describe("InMemoryProductRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's product by id, slug, sku, or list, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const p = product(nextId, "SKU-ISO-1", "iso-product-1");
    await repository.save(p, "tenant-a");

    expect(await repository.findById(p.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(p.id.toString(), "tenant-b")).toBeNull();

    expect(await repository.findBySlug("iso-product-1", "tenant-a")).not.toBeNull();
    expect(await repository.findBySlug("iso-product-1", "tenant-b")).toBeNull();

    expect(await repository.findBySku("SKU-ISO-1", "tenant-a")).not.toBeNull();
    expect(await repository.findBySku("SKU-ISO-1", "tenant-b")).toBeNull();

    const pageA = await repository.list({}, "tenant-a");
    const pageB = await repository.list({}, "tenant-b");
    expect(pageA.items.map((x) => x.id.toString())).toContain(p.id.toString());
    expect(pageB.items.map((x) => x.id.toString())).not.toContain(p.id.toString());
  });
});
