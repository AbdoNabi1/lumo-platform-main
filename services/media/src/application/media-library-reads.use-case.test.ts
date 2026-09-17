import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
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
  return { folders, mediaAssets, unitOfWork, idGenerator, clock, objectStorage };
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
      storageKey: "media/hero.png",
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
