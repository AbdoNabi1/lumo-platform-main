import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { InMemoryUsageRecorder } from "@platform/usage";
import { AttachMedia } from "./attach-media.use-case";
import { CreateProduct } from "./create-product.use-case";
import { DetachMedia } from "./detach-media.use-case";
import type { MediaLookupPort } from "./media-lookup.port";
import { SetVariantImage } from "./set-variant-image.use-case";
import { CatalogEventTranslator } from "../infrastructure/catalog-event-translator";
import { InMemoryProductRepository } from "../infrastructure/in-memory-product-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";

const TENANT = "tenant-1";
const clock: Clock = { now: () => new Date("2026-10-14T00:00:00.000Z") };

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

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
  return {
    products,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: sequentialIds(),
    clock,
    usage: new InMemoryUsageRecorder(),
  };
}

async function seed(h: ReturnType<typeof harness>) {
  const created = await new CreateProduct(h).execute({
    sku: "P-1",
    name: "Tee",
    slug: "tee",
    variants: [{ sku: "P-1-V1", priceAmountMinor: 1000, currency: "USD" }],
    tenantId: TENANT,
  });
  if (!created.ok) throw new Error("fixture failed");
  const stored = await h.products.findById(created.value.id, TENANT);
  return { productId: created.value.id, variantId: stored!.variants[0]!.id.toString() };
}

describe("AttachMedia — the asset must be this tenant's (Plan 2C-3)", () => {
  const lookup = (known: Record<string, string>): MediaLookupPort => ({
    existingIds: async (ids, tenantId) => ids.filter((id) => known[id] === tenantId),
  });

  it("attaches an asset the tenant owns", async () => {
    const h = harness();
    const { productId } = await seed(h);
    const result = await new AttachMedia({
      ...h,
      mediaLookup: lookup({ "asset-1": TENANT }),
    }).execute({ productId, assetId: "asset-1", tenantId: TENANT });
    expect(result.ok).toBe(true);
    expect((await h.products.findById(productId, TENANT))!.media.map((m) => m.assetId)).toEqual([
      "asset-1",
    ]);
  });

  it("refuses another tenant's asset and an unknown one, with the same not-found answer", async () => {
    const h = harness();
    const { productId } = await seed(h);
    const attach = new AttachMedia({ ...h, mediaLookup: lookup({ theirs: "tenant-2" }) });

    const foreign = await attach.execute({ productId, assetId: "theirs", tenantId: TENANT });
    const unknown = await attach.execute({ productId, assetId: "nope", tenantId: TENANT });

    expect(!foreign.ok && foreign.error.code).toBe("NOT_FOUND");
    expect(!unknown.ok && unknown.error.code).toBe("NOT_FOUND");
    expect((await h.products.findById(productId, TENANT))!.media).toHaveLength(0);
  });
});

describe("SetVariantImage", () => {
  async function productWithMedia() {
    const h = harness();
    const ids = await seed(h);
    const attach = new AttachMedia(h);
    await attach.execute({ productId: ids.productId, assetId: "asset-1", tenantId: TENANT });
    await attach.execute({ productId: ids.productId, assetId: "asset-2", tenantId: TENANT });
    return { h, ...ids, set: new SetVariantImage(h) };
  }
  const imageOf = async (h: ReturnType<typeof harness>, productId: string, tenantId = TENANT) =>
    (await h.products.findById(productId, tenantId))!.variants[0]!.mediaRef;

  it("sets one of the product's media as the variant's image, and clears it with null", async () => {
    const { h, productId, variantId, set } = await productWithMedia();
    const done = await set.execute({ productId, variantId, mediaId: "asset-2", tenantId: TENANT });
    expect(done.ok).toBe(true);
    expect(await imageOf(h, productId)).toBe("asset-2");

    await set.execute({ productId, variantId, mediaId: null, tenantId: TENANT });
    expect(await imageOf(h, productId)).toBeNull();
  });

  it("refuses media that is not one of this product's", async () => {
    const { h, productId, variantId, set } = await productWithMedia();
    const result = await set.execute({
      productId,
      variantId,
      mediaId: "not-attached",
      tenantId: TENANT,
    });
    expect(!result.ok && result.error.code).toBe("BUSINESS_RULE");
    expect(await imageOf(h, productId)).toBeNull();
  });

  it("is not-found for another tenant's product and for an unknown variant", async () => {
    const { productId, variantId, set } = await productWithMedia();
    const foreign = await set.execute({
      productId,
      variantId,
      mediaId: "asset-1",
      tenantId: "tenant-2",
    });
    const unknownVariant = await set.execute({
      productId,
      variantId: "nope",
      mediaId: "asset-1",
      tenantId: TENANT,
    });
    expect(!foreign.ok && foreign.error.code).toBe("NOT_FOUND");
    expect(!unknownVariant.ok && unknownVariant.error.code).toBe("BUSINESS_RULE");
  });

  it("is cleared automatically when its media is detached", async () => {
    const { h, productId, variantId, set } = await productWithMedia();
    await set.execute({ productId, variantId, mediaId: "asset-1", tenantId: TENANT });
    await new DetachMedia(h).execute({ productId, assetId: "asset-1", tenantId: TENANT });
    expect(await imageOf(h, productId)).toBeNull();
  });
});
