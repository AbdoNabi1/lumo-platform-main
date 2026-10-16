import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { ValidationError } from "@platform/utils";
import { InMemoryUsageRecorder } from "@platform/usage";
import { CreateProduct } from "./create-product.use-case";
import { RelabelVariantCurrency } from "./relabel-variant-currency.use-case";
import { CatalogEventTranslator } from "../infrastructure/catalog-event-translator";
import { InMemoryProductRepository } from "../infrastructure/in-memory-product-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-10-11T00:00:00.000Z") };

function harness() {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new CatalogEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "catalog",
  });
  const products = new InMemoryProductRepository({
    outbox,
    context: rootEventContext(sequentialIds()),
  });
  const deps = {
    products,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: sequentialIds(),
    clock,
    usage: new InMemoryUsageRecorder(),
  };
  return { products, create: new CreateProduct(deps), relabel: new RelabelVariantCurrency(deps) };
}

async function seed(h: ReturnType<typeof harness>, tenantId: string, sku: string) {
  const created = await h.create.execute({
    sku,
    name: sku,
    slug: sku.toLowerCase(),
    variants: [
      {
        sku: `${sku}-V1`,
        priceAmountMinor: 12_500,
        currency: "USD",
        compareAtAmountMinor: 15_000,
        costAmountMinor: 4_000,
      },
      { sku: `${sku}-V2`, priceAmountMinor: 9_900, currency: "USD" },
    ],
    tenantId,
  });
  if (!created.ok) throw new Error("fixture failed");
  return created.value.id;
}

describe("RelabelVariantCurrency (Plan 3C — the store currency)", () => {
  it("switches every variant's currency and keeps every amount", async () => {
    const h = harness();
    const id = await seed(h, "t1", "P1");
    const result = await h.relabel.execute({ tenantId: "t1", currency: "EGP" });
    expect(result).toEqual({ ok: true, value: { relabelled: 2 } });
    const product = await h.products.findById(id, "t1");
    const [first, second] = product?.variants ?? [];
    expect(first?.price.currency).toBe("EGP");
    expect(first?.price.amountMinor).toBe(12_500);
    expect(first?.attributes.compareAtPrice).toMatchObject({
      currency: "EGP",
      amountMinor: 15_000,
    });
    expect(first?.attributes.cost).toMatchObject({ currency: "EGP", amountMinor: 4_000 });
    expect(second?.price).toMatchObject({ currency: "EGP", amountMinor: 9_900 });
  });

  it("leaves another tenant's products untouched", async () => {
    const h = harness();
    await seed(h, "t1", "P1");
    const other = await seed(h, "t2", "P2");
    await h.relabel.execute({ tenantId: "t1", currency: "EGP" });
    const product = await h.products.findById(other, "t2");
    expect(product?.variants[0]?.price.currency).toBe("USD");
  });

  it("is idempotent: a second run changes nothing", async () => {
    const h = harness();
    await seed(h, "t1", "P1");
    await h.relabel.execute({ tenantId: "t1", currency: "EGP" });
    const again = await h.relabel.execute({ tenantId: "t1", currency: "EGP" });
    expect(again).toEqual({ ok: true, value: { relabelled: 0 } });
  });

  it("rejects a currency that is not a 3-letter code", async () => {
    const h = harness();
    const result = await h.relabel.execute({ tenantId: "t1", currency: "egp" });
    expect(!result.ok && result.error).toBeInstanceOf(ValidationError);
  });
});
