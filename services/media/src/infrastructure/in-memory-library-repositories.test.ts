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

describe("InMemoryMediaAssetRepository.findByIds (Plan 2C-3)", () => {
  it("returns only the caller tenant's assets among the ids, and skips unknown ones", async () => {
    const { mediaAssets, nextId } = wire();
    const mine = MediaAsset.create(
      UniqueEntityId.from(nextId()),
      "a.png",
      "tenants/a/k1.png",
      nextId(),
      new Date(0),
    );
    const theirs = MediaAsset.create(
      UniqueEntityId.from(nextId()),
      "b.png",
      "tenants/b/k2.png",
      nextId(),
      new Date(0),
    );
    await mediaAssets.save(mine, "tenant-a");
    await mediaAssets.save(theirs, "tenant-b");

    const found = await mediaAssets.findByIds(
      [mine.id.toString(), theirs.id.toString(), "does-not-exist"],
      "tenant-a",
    );

    expect(found.map((a) => a.id.toString())).toEqual([mine.id.toString()]);
    expect(await mediaAssets.findByIds([mine.id.toString()], "tenant-b")).toEqual([]);
    expect(await mediaAssets.findByIds([], "tenant-a")).toEqual([]);
  });
});

describe("media asset list filters", () => {
  it("filters, sorts, paginates and isolates tenants", async () => {
    expect.hasAssertions();
    const { mediaAssets } = wire();
    const ids = [1, 2, 3, 4].map((n) => `0190a000-0000-7000-8000-00000000000${n}`);
    const assets = ids.map((id, i) =>
      MediaAsset.create(
        UniqueEntityId.from(id),
        ["Beach.png", "logo.webp", "beach-2.jpg", "Beach-other.png"][i]!,
        `media/${id}`,
        id,
        new Date(0),
      ),
    );
    assets[1]!.archive(ids[1]!, new Date(0));
    for (const asset of assets.slice(0, 3)) await mediaAssets.save(asset, "tenant-a");
    await mediaAssets.save(assets[3]!, "tenant-b");
    const list = async (query: Parameters<typeof mediaAssets.list>[0]) =>
      (await mediaAssets.list(query, "tenant-a")).items.map((a) => a.id.toString());
    expect(await list({})).toEqual(ids.slice(0, 3));
    expect(await list({ status: "active" })).toEqual([ids[0], ids[2]]);
    expect(await list({ search: "BEACH" })).toEqual([ids[0], ids[2]]);
    expect(await list({ sort: "newest" })).toEqual([ids[2], ids[1], ids[0]]);
    const first = await mediaAssets.list({ sort: "newest", first: 1 }, "tenant-a");
    expect(first.items[0]!.id.toString()).toBe(ids[2]);
    expect(first.pageInfo.endCursor).toBe(ids[2]);
    expect(first.pageInfo.hasNextPage).toBe(true);
    expect(await list({ sort: "newest", first: 1, after: ids[2]! })).toEqual([ids[1]]);
  });
});
