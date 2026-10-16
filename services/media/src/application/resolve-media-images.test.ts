import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { type ImageDetails, MediaAsset } from "../domain/media-asset";
import type { MediaAssetRepository } from "../domain/library-repositories";
import { InMemoryMediaAssetRepository } from "../infrastructure/in-memory-library-repositories";
import { MediaLibraryEventTranslator } from "../infrastructure/media-library-event-translator";
import { ResolveMediaImages } from "./resolve-media-images.use-case";

const clock: Clock = { now: () => new Date("2026-10-14T00:00:00.000Z") };
const BASE = "https://cdn.example.test/media/";
let counter = 0;
const ids: IdGenerator = { generate: () => `evt-${(counter += 1)}` };

function setup() {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new MediaLibraryEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "media",
  });
  const inner = new InMemoryMediaAssetRepository({ outbox, context: rootEventContext(ids) });
  const reads = { findByIds: 0, findById: 0 };
  const mediaAssets: MediaAssetRepository = {
    save: (asset, tenantId, tx) => inner.save(asset, tenantId, tx),
    findById: (id, tenantId) => {
      reads.findById += 1;
      return inner.findById(id, tenantId);
    },
    findByIds: (wanted, tenantId) => {
      reads.findByIds += 1;
      return inner.findByIds(wanted, tenantId);
    },
    list: (page, tenantId) => inner.list(page, tenantId),
  };
  const add = async (id: string, tenantId: string, details: ImageDetails = {}) => {
    const asset = MediaAsset.create(
      UniqueEntityId.from(id),
      `${id}.png`,
      `tenants/${tenantId}/product-images/2026/10/${id}.png`,
      ids.generate(),
      clock.now(),
      undefined,
      details,
    );
    await mediaAssets.save(asset, tenantId);
    return asset;
  };
  return { mediaAssets, reads, add, inner };
}

describe("ResolveMediaImages (Plan 2C-3)", () => {
  it("resolves many ids with ONE read, to public urls with alt and size", async () => {
    const { mediaAssets, reads, add } = setup();
    await add("a", "t1", { alt: "Front", width: 800, height: 600, contentType: "image/png" });
    await add("b", "t1", { width: 10, height: 10 });
    const resolver = new ResolveMediaImages({ mediaAssets, publicBaseUrl: BASE });

    const images = await resolver.execute({ ids: ["a", "b"], tenantId: "t1" });

    expect(reads.findByIds).toBe(1);
    expect(reads.findById).toBe(0);
    expect(images.get("a")).toEqual({
      id: "a",
      url: "https://cdn.example.test/media/tenants/t1/product-images/2026/10/a.png",
      alt: "Front",
      width: 800,
      height: 600,
    });
    expect(images.get("b")).toMatchObject({ alt: null, width: 10, height: 10 });
  });

  it("makes no read at all for an empty list", async () => {
    const { mediaAssets, reads } = setup();
    const resolver = new ResolveMediaImages({ mediaAssets, publicBaseUrl: BASE });
    expect((await resolver.execute({ ids: [], tenantId: "t1" })).size).toBe(0);
    expect(reads.findByIds).toBe(0);
  });

  it("skips a missing asset instead of failing, and reports legacy assets with no size as null", async () => {
    const { mediaAssets, add } = setup();
    await add("legacy", "t1");
    const resolver = new ResolveMediaImages({ mediaAssets, publicBaseUrl: BASE });

    const images = await resolver.execute({ ids: ["legacy", "gone"], tenantId: "t1" });

    expect([...images.keys()]).toEqual(["legacy"]);
    expect(images.get("legacy")).toMatchObject({ alt: null, width: null, height: null });
  });

  it("never resolves another tenant's asset", async () => {
    const { mediaAssets, add } = setup();
    await add("theirs", "t2");
    const resolver = new ResolveMediaImages({ mediaAssets, publicBaseUrl: BASE });
    expect((await resolver.execute({ ids: ["theirs"], tenantId: "t1" })).size).toBe(0);
  });

  it("skips archived assets", async () => {
    const { mediaAssets, add } = setup();
    const asset = await add("old", "t1");
    asset.archive(ids.generate(), clock.now());
    await mediaAssets.save(asset, "t1");
    const resolver = new ResolveMediaImages({ mediaAssets, publicBaseUrl: BASE });
    expect((await resolver.execute({ ids: ["old"], tenantId: "t1" })).size).toBe(0);
  });

  it("returns nothing when there is no public base url (no url can be made)", async () => {
    const { mediaAssets, add } = setup();
    await add("a", "t1");
    const resolver = new ResolveMediaImages({ mediaAssets });
    expect((await resolver.execute({ ids: ["a"], tenantId: "t1" })).size).toBe(0);
  });

  it("exposes only id, url, alt, width and height — never the storage key", async () => {
    const { mediaAssets, add } = setup();
    await add("a", "t1", { width: 1, height: 1 });
    const resolver = new ResolveMediaImages({ mediaAssets, publicBaseUrl: BASE });
    const image = (await resolver.execute({ ids: ["a"], tenantId: "t1" })).get("a")!;
    expect(Object.keys(image).sort()).toEqual(["alt", "height", "id", "url", "width"]);
  });

  it("existingIds answers with the tenant's active ids only, in one read", async () => {
    const { mediaAssets, reads, add } = setup();
    await add("mine", "t1");
    await add("theirs", "t2");
    const resolver = new ResolveMediaImages({ mediaAssets });
    expect(await resolver.existingIds(["mine", "theirs", "gone"], "t1")).toEqual(["mine"]);
    expect(reads.findByIds).toBe(1);
  });
});
