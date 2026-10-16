import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { SearchIndex } from "../domain/search-index";
import { SearchEventTranslator } from "./search-event-translator";
import { InMemorySearchIndexRepository } from "./in-memory-search-index-repository";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new SearchEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "search",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemorySearchIndexRepository({ outbox, context });
  return { repository, nextId };
}

describe("InMemorySearchIndexRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's index by id, name, or list, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const index = SearchIndex.create(UniqueEntityId.from(nextId()), "products");
    await repository.save(index, "tenant-a");

    expect(await repository.findById(index.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(index.id.toString(), "tenant-b")).toBeNull();

    expect(await repository.findByName("products", "tenant-a")).not.toBeNull();
    expect(await repository.findByName("products", "tenant-b")).toBeNull();

    const pageA = await repository.list({}, "tenant-a");
    const pageB = await repository.list({}, "tenant-b");
    expect(pageA.items.map((i) => i.id.toString())).toContain(index.id.toString());
    expect(pageB.items.map((i) => i.id.toString())).not.toContain(index.id.toString());
  });
});

describe("InMemorySearchIndexRepository write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("search", async (outbox, tenantId) => {
      const nextId = monotonicIds();
      const repository = new InMemorySearchIndexRepository({
        outbox,
        context: rootEventContext({ generate: nextId }),
      });
      const agg = SearchIndex.create(UniqueEntityId.from(nextId()), "products");
      agg.recordDocumentUpserted("product-1", nextId(), new Date(0));
      await repository.save(agg, tenantId);
    });
  });
});
