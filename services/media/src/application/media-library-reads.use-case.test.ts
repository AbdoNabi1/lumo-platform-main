import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { MediaAsset } from "../domain/media-asset";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { GetFolder } from "./get-folder.use-case";
import { GetMediaAsset } from "./get-media-asset.use-case";
import { ListFolders } from "./list-folders.use-case";
import { ListMediaAssets } from "./list-media-assets.use-case";
import { CreateFolder, RegisterMediaAsset } from "./media-library.use-cases";
import {
  InMemoryFolderRepository,
  InMemoryMediaAssetRepository,
} from "../infrastructure/in-memory-library-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { InMemoryObjectStorage } from "../infrastructure/object-storage-adapters";
import { MediaLibraryEventTranslator } from "../infrastructure/media-library-event-translator";
import { TenantPrefixedKeyPolicy } from "../infrastructure/tenant-prefixed-key-policy";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new MediaLibraryEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "media",
  });
  const context = rootEventContext(sequentialIds());
  const folders = new InMemoryFolderRepository({ outbox, context });
  const mediaAssets = new InMemoryMediaAssetRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  const objectStorage = new InMemoryObjectStorage();
  const keyPolicy = new TenantPrefixedKeyPolicy();
  return { folders, mediaAssets, unitOfWork, idGenerator, clock, objectStorage, keyPolicy };
}

describe("Media Library read use-cases (Phase 4 T4.14)", () => {
  it("ListFolders paginates and GetFolder returns the folder, or NotFoundError", async () => {
    const h = harness();
    const create = new CreateFolder(h);
    for (let i = 0; i < 2; i += 1) {
      await create.execute({ name: `Folder ${i}`, tenantId: "tenant-1" });
    }

    const listed = await new ListFolders(h).execute({ first: 10, tenantId: "tenant-1" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.items).toHaveLength(2);

    const created = await create.execute({ name: "Product images", tenantId: "tenant-1" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetFolder(h).execute({
      folderId: created.value.folderId,
      tenantId: "tenant-1",
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.name).toBe("Product images");

    const missing = await new GetFolder(h).execute({ folderId: "nope", tenantId: "tenant-1" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });

  it("ListMediaAssets paginates and GetMediaAsset returns the asset, or NotFoundError", async () => {
    const h = harness();
    const created = await new RegisterMediaAsset(h).execute({
      name: "hero.png",
      storageKey: "tenants/tenant-1/product-images/2026/09/hero.png",
      tenantId: "tenant-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const listed = await new ListMediaAssets(h).execute({ first: 10, tenantId: "tenant-1" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.items).toHaveLength(1);

    const found = await new GetMediaAsset(h).execute({
      mediaAssetId: created.value.mediaAssetId,
      tenantId: "tenant-1",
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.name).toBe("hero.png");

    const missing = await new GetMediaAsset(h).execute({
      mediaAssetId: "nope",
      tenantId: "tenant-1",
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});

describe("ListMediaAssets filters", () => {
  it("passes filters, ordering, cursor and tenant to the repository", async () => {
    const h = harness();
    const ids = [1, 2, 3, 4].map((n) => `0190a000-0000-7000-8000-00000000000${n}`);
    const assets = ids.map((id, i) =>
      MediaAsset.create(
        UniqueEntityId.from(id),
        ["Beach.png", "logo.webp", "beach-2.jpg", "other.png"][i]!,
        `media/${id}`,
        id,
        new Date(0),
      ),
    );
    assets[1]!.archive(ids[1]!, new Date(0));
    for (const asset of assets.slice(0, 3)) await h.mediaAssets.save(asset, "tenant-a");
    await h.mediaAssets.save(assets[3]!, "tenant-b");
    const useCase = new ListMediaAssets(h);
    const list = async (query: Omit<Parameters<typeof useCase.execute>[0], "tenantId">) => {
      const result = await useCase.execute({ ...query, tenantId: "tenant-a" });
      if (!result.ok) throw result.error;
      return result.value;
    };
    const getIds = (page: Awaited<ReturnType<typeof list>>) =>
      page.items.map((a) => a.id.toString());
    expect(getIds(await list({}))).toEqual(ids.slice(0, 3));
    expect(getIds(await list({ status: "active" }))).toEqual([ids[0], ids[2]]);
    expect(getIds(await list({ search: "BEACH" }))).toEqual([ids[0], ids[2]]);
    expect(getIds(await list({ sort: "newest" }))).toEqual([ids[2], ids[1], ids[0]]);
    const first = await list({ sort: "newest", first: 1 });
    expect(getIds(first)).toEqual([ids[2]]);
    expect(first.pageInfo.endCursor).toBe(ids[2]);
    expect(getIds(await list({ sort: "newest", first: 1, after: ids[2]! }))).toEqual([ids[1]]);
  });
});
