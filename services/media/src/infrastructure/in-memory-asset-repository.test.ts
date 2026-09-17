import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Asset } from "../domain/asset";
import { ContentType } from "../domain/value-objects/content-type";
import { StorageKey } from "../domain/value-objects/storage-key";
import { MediaEventTranslator } from "./media-event-translator";
import { InMemoryAssetRepository } from "./in-memory-asset-repository";

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
    translator: new MediaEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "media",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemoryAssetRepository({ outbox, context });
  return { repository, nextId };
}

describe("InMemoryAssetRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's asset by id, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const asset = Asset.register(
      UniqueEntityId.from(nextId()),
      must(StorageKey.create("uploads/a.png")),
      must(ContentType.create("image/png")),
      nextId(),
      new Date(0),
    );
    await repository.save(asset, "tenant-a");

    expect(await repository.findById(asset.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(asset.id.toString(), "tenant-b")).toBeNull();
  });
});
