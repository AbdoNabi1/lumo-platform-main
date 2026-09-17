import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { RecommendationModel } from "../domain/recommendation-model";
import { RecommendationStrategy } from "../domain/value-objects/recommendation-strategy";
import { RecommendationsEventTranslator } from "./recommendations-event-translator";
import { InMemoryRecommendationModelRepository } from "./in-memory-recommendation-model-repository";

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
    translator: new RecommendationsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date("2026-07-05T00:00:00.000Z") },
    producer: "recommendations",
  });
  const context = rootEventContext({ generate: nextId });
  const repository = new InMemoryRecommendationModelRepository({ outbox, context });
  return { repository, nextId };
}

describe("InMemoryRecommendationModelRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's model by id, name, or list, through a single repository instance", async () => {
    const { repository, nextId } = wire();
    const model = RecommendationModel.create(
      UniqueEntityId.from(nextId()),
      "related-products",
      must(RecommendationStrategy.create("related")),
    );
    await repository.save(model, "tenant-a");

    expect(await repository.findById(model.id.toString(), "tenant-a")).not.toBeNull();
    expect(await repository.findById(model.id.toString(), "tenant-b")).toBeNull();

    expect(await repository.findByName("related-products", "tenant-a")).not.toBeNull();
    expect(await repository.findByName("related-products", "tenant-b")).toBeNull();

    const pageA = await repository.list({}, "tenant-a");
    const pageB = await repository.list({}, "tenant-b");
    expect(pageA.items.map((m) => m.id.toString())).toContain(model.id.toString());
    expect(pageB.items.map((m) => m.id.toString())).not.toContain(model.id.toString());
  });
});
