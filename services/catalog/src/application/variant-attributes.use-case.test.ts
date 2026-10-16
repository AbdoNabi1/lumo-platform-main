import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { ValidationError } from "@platform/utils";
import { InMemoryUsageRecorder } from "@platform/usage";
import { AddVariant } from "./add-variant.use-case";
import { CreateProduct } from "./create-product.use-case";
import { SetProductOptions } from "./set-product-options.use-case";
import { UpdateVariant } from "./update-variant.use-case";
import { CatalogEventTranslator } from "../infrastructure/catalog-event-translator";
import { InMemoryProductRepository } from "../infrastructure/in-memory-product-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";

const TENANT = "tenant-1";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-10-08T00:00:00.000Z") };

function harness() {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new CatalogEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "catalog",
  });
  const context = rootEventContext(sequentialIds());
  const products = new InMemoryProductRepository({ outbox, context });
  return {
    products,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: sequentialIds(),
    clock,
    usage: new InMemoryUsageRecorder(),
  };
}

async function seedProduct(h: ReturnType<typeof harness>) {
  const created = await new CreateProduct(h).execute({
    sku: "P-1",
    name: "Tee",
    slug: "tee",
    variants: [{ sku: "P-1-V1", priceAmountMinor: 1000, currency: "USD" }],
    tenantId: TENANT,
  });
  if (!created.ok) throw new Error("fixture failed");
  const stored = await h.products.findById(created.value.id, TENANT);
  const variantId = stored?.variants[0]?.id.toString();
  if (variantId === undefined) throw new Error("fixture failed");
  return { productId: created.value.id, variantId };
}

const FULL_ATTRIBUTES = {
  compareAtAmountMinor: 1500,
  costAmountMinor: 400,
  barcode: " 622 ",
  weightGrams: 250,
  requiresShipping: false,
  taxable: false,
};

describe("Variant attributes through the use cases (Plan 2C-1)", () => {
  it("AddVariant stores every attribute, trimming the barcode", async () => {
    const h = harness();
    const { productId } = await seedProduct(h);
    const added = await new AddVariant(h).execute({
      productId,
      sku: "P-1-V2",
      priceAmountMinor: 1000,
      currency: "USD",
      ...FULL_ATTRIBUTES,
      tenantId: TENANT,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const product = await h.products.findById(productId, TENANT);
    const attributes = product?.variants.find(
      (v) => v.id.toString() === added.value.variantId,
    )?.attributes;
    expect(attributes?.compareAtPrice?.amountMinor).toBe(1500);
    expect(attributes?.cost?.amountMinor).toBe(400);
    expect(attributes?.barcode).toBe("622");
    expect(attributes?.weightGrams).toBe(250);
    expect(attributes?.requiresShipping).toBe(false);
    expect(attributes?.taxable).toBe(false);
  });

  it("AddVariant with compare-at equal to the price is a VALIDATION error and saves nothing", async () => {
    const h = harness();
    const { productId } = await seedProduct(h);
    const result = await new AddVariant(h).execute({
      productId,
      sku: "P-1-V2",
      priceAmountMinor: 1000,
      currency: "USD",
      compareAtAmountMinor: 1000,
      tenantId: TENANT,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    expect(result.error).toBeInstanceOf(ValidationError);
    expect((result.error as ValidationError).fields.map((f) => f.field)).toContain(
      "compareAtAmountMinor",
    );
    const product = await h.products.findById(productId, TENANT);
    expect(product?.variants).toHaveLength(1);
  });

  it("UpdateVariant with only sku/price/currency keeps every attribute", async () => {
    const h = harness();
    const { productId } = await seedProduct(h);
    const added = await new AddVariant(h).execute({
      productId,
      sku: "P-1-V2",
      priceAmountMinor: 1000,
      currency: "USD",
      ...FULL_ATTRIBUTES,
      tenantId: TENANT,
    });
    if (!added.ok) throw new Error("fixture failed");
    const updated = await new UpdateVariant(h).execute({
      productId,
      variantId: added.value.variantId,
      sku: "P-1-V2",
      priceAmountMinor: 1100,
      currency: "USD",
      tenantId: TENANT,
    });
    expect(updated.ok).toBe(true);
    const product = await h.products.findById(productId, TENANT);
    const variant = product?.variants.find((v) => v.id.toString() === added.value.variantId);
    expect(variant?.price.amountMinor).toBe(1100);
    expect(variant?.attributes.compareAtPrice?.amountMinor).toBe(1500);
    expect(variant?.attributes.cost?.amountMinor).toBe(400);
    expect(variant?.attributes.barcode).toBe("622");
    expect(variant?.attributes.weightGrams).toBe(250);
    expect(variant?.attributes.requiresShipping).toBe(false);
    expect(variant?.attributes.taxable).toBe(false);
  });

  it("UpdateVariant with compareAtAmountMinor: null clears it and leaves cost alone", async () => {
    const h = harness();
    const { productId } = await seedProduct(h);
    const added = await new AddVariant(h).execute({
      productId,
      sku: "P-1-V2",
      priceAmountMinor: 1000,
      currency: "USD",
      ...FULL_ATTRIBUTES,
      tenantId: TENANT,
    });
    if (!added.ok) throw new Error("fixture failed");
    const updated = await new UpdateVariant(h).execute({
      productId,
      variantId: added.value.variantId,
      sku: "P-1-V2",
      priceAmountMinor: 1000,
      currency: "USD",
      compareAtAmountMinor: null,
      tenantId: TENANT,
    });
    expect(updated.ok).toBe(true);
    const product = await h.products.findById(productId, TENANT);
    const variant = product?.variants.find((v) => v.id.toString() === added.value.variantId);
    expect(variant?.attributes.compareAtPrice).toBeNull();
    expect(variant?.attributes.cost?.amountMinor).toBe(400);
  });

  it("UpdateVariant sets the selection when given, and clears it with null", async () => {
    const h = harness();
    const { productId, variantId } = await seedProduct(h);
    const options = await new SetProductOptions(h).execute({
      productId,
      options: [{ name: "Size", values: ["S", "L"] }],
      tenantId: TENANT,
    });
    expect(options.ok).toBe(true);
    const base = {
      productId,
      variantId,
      sku: "P-1-V1",
      priceAmountMinor: 1000,
      currency: "USD",
      tenantId: TENANT,
    };

    const set = await new UpdateVariant(h).execute({ ...base, selection: { Size: "S" } });
    expect(set.ok).toBe(true);
    let product = await h.products.findById(productId, TENANT);
    expect(product?.variants[0]?.selection?.values).toEqual({ Size: "S" });

    const kept = await new UpdateVariant(h).execute(base);
    expect(kept.ok).toBe(true);
    product = await h.products.findById(productId, TENANT);
    expect(product?.variants[0]?.selection?.values).toEqual({ Size: "S" });

    const cleared = await new UpdateVariant(h).execute({ ...base, selection: null });
    expect(cleared.ok).toBe(true);
    product = await h.products.findById(productId, TENANT);
    expect(product?.variants[0]?.selection).toBeNull();
  });

  it("CreateProduct stores variant attributes, and refuses two currencies without saving", async () => {
    const h = harness();
    const created = await new CreateProduct(h).execute({
      sku: "P-2",
      name: "Cap",
      slug: "cap",
      variants: [{ sku: "P-2-V1", priceAmountMinor: 1000, currency: "USD", weightGrams: 300 }],
      tenantId: TENANT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const product = await h.products.findById(created.value.id, TENANT);
    expect(product?.variants[0]?.attributes.weightGrams).toBe(300);

    const mixed = await new CreateProduct(h).execute({
      sku: "P-3",
      name: "Mixed",
      slug: "mixed",
      variants: [
        { sku: "P-3-V1", priceAmountMinor: 1000, currency: "USD" },
        { sku: "P-3-V2", priceAmountMinor: 1000, currency: "EGP" },
      ],
      tenantId: TENANT,
    });
    expect(mixed.ok).toBe(false);
    expect(await h.products.findBySlug("mixed", TENANT)).toBeNull();
  });
});
