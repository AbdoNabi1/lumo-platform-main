import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Folder } from "../domain/folder";
import { MediaAsset } from "../domain/media-asset";
import { MediaLibraryEventTranslator } from "./media-library-event-translator";
import {
  InMemoryFolderRepository,
  InMemoryMediaAssetRepository,
} from "./in-memory-library-repositories";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new MediaLibraryEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "media",
  });
  const context = rootEventContext({ generate: nextId });
  return {
    folders: new InMemoryFolderRepository({ outbox, context }),
    mediaAssets: new InMemoryMediaAssetRepository({ outbox, context }),
    nextId,
  };
}

describe("InMemoryFolderRepository / InMemoryMediaAssetRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's folder by id or list, through a single repository instance", async () => {
    const { folders, nextId } = wire();
    const folder = Folder.create(
      UniqueEntityId.from(nextId()),
      "Product images",
      nextId(),
      new Date(0),
    );
    await folders.save(folder, "tenant-a");

    expect(await folders.findById(folder.id.toString(), "tenant-a")).not.toBeNull();
    expect(await folders.findById(folder.id.toString(), "tenant-b")).toBeNull();

    const pageA = await folders.list({}, "tenant-a");
    const pageB = await folders.list({}, "tenant-b");
    expect(pageA.items.map((f) => f.id.toString())).toContain(folder.id.toString());
    expect(pageB.items.map((f) => f.id.toString())).not.toContain(folder.id.toString());
  });

  it("does not let tenant A read tenant B's media asset by id or list, through a single repository instance", async () => {
    const { mediaAssets, nextId } = wire();
    const asset = MediaAsset.create(
      UniqueEntityId.from(nextId()),
      "hero.png",
      "media/hero.png",
      nextId(),
      new Date(0),
    );
    await mediaAssets.save(asset, "tenant-a");

    expect(await mediaAssets.findById(asset.id.toString(), "tenant-a")).not.toBeNull();
    expect(await mediaAssets.findById(asset.id.toString(), "tenant-b")).toBeNull();

    const pageA = await mediaAssets.list({}, "tenant-a");
    const pageB = await mediaAssets.list({}, "tenant-b");
    expect(pageA.items.map((a) => a.id.toString())).toContain(asset.id.toString());
    expect(pageB.items.map((a) => a.id.toString())).not.toContain(asset.id.toString());
  });
});
