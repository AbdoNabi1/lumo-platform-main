import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { ContentBlock } from "../domain/content-block";
import { BlockBody } from "../domain/value-objects/block-body";
import { ContentEventTranslator } from "./content-event-translator";
import { InMemoryContentBlockRepository } from "./in-memory-repositories";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new ContentEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "content",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemoryContentBlockRepository({ outbox, context });
  return { repository, nextId };
}

describe("InMemoryContentBlockRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's block by id, name, or list, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const block = ContentBlock.create(
      UniqueEntityId.from(nextId()),
      "homepage-hero",
      "hero",
      BlockBody.create("html", "<h1>Hello</h1>"),
    );
    await repository.save(block, "tenant-a");

    expect(await repository.findById(block.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(block.id.toString(), "tenant-b")).toBeNull();

    expect(await repository.findByName("homepage-hero", "tenant-a")).not.toBeNull();
    expect(await repository.findByName("homepage-hero", "tenant-b")).toBeNull();

    const pageA = await repository.list({}, "tenant-a");
    const pageB = await repository.list({}, "tenant-b");
    expect(pageA.items.map((b) => b.id.toString())).toContain(block.id.toString());
    expect(pageB.items.map((b) => b.id.toString())).not.toContain(block.id.toString());
  });
});
