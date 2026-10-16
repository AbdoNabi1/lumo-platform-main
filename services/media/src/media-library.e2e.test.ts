import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireMediaLibrary } from "./media-library.composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wireMediaLibrary({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("media library (end to end)", () => {
  it("runs the full lifecycle: create folder -> register asset -> download url, publishing canonical events", async () => {
    const app = wire();
    const folder = await app.mediaLibrary.createFolder({
      name: "Product images",
      tenantId: "tenant-local",
    });
    expect(folder.status).toBe(201);
    const folderId = (folder.body as { folderId: string }).folderId;

    const asset = await app.mediaLibrary.registerMediaAsset({
      name: "hero.png",
      storageKey: "tenants/tenant-local/product-images/2026/09/hero.png",
      folderRef: folderId,
      tenantId: "tenant-local",
    });
    expect(asset.status).toBe(201);
    const mediaAssetId = (asset.body as { mediaAssetId: string }).mediaAssetId;

    const url = await app.mediaLibrary.getDownloadUrl({
      mediaAssetId,
      tenantId: "tenant-local",
    });
    expect(url.status).toBe(200);
    expect((url.body as { url: string }).url).toContain(
      "tenants/tenant-local/product-images/2026/09/hero.png",
    );

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("media.folder.created");
    expect(app.deliveredEventTypes).toContain("media.media_asset.created");
  });

  it("returns 404 for an unknown media asset", async () => {
    const app = wire();
    const response = await app.mediaLibrary.archiveMediaAsset({
      mediaAssetId: "missing",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(404);
  });
});
