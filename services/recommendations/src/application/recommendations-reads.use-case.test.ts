import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { GetModel } from "./get-model.use-case";
import { ListModels } from "./list-models.use-case";
import { CreateModel } from "./recommendation.use-cases";
import { InMemoryRecommendationModelRepository } from "../infrastructure/in-memory-recommendation-model-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { RecommendationsEventTranslator } from "../infrastructure/recommendations-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new RecommendationsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "recommendations",
  });
  const context = rootEventContext(sequentialIds());
  const models = new InMemoryRecommendationModelRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { models, unitOfWork, idGenerator, clock };
}

describe("Recommendations read use-cases (Phase 4 T4.18)", () => {
  it("ListModels paginates", async () => {
    const h = harness();
    const create = new CreateModel(h);
    for (let i = 0; i < 3; i += 1) {
      await create.execute({ name: `model-${i}`, strategy: "related" });
    }

    const page = await new ListModels(h).execute({ first: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await new ListModels(h).execute({
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("GetModel returns the model, or NotFoundError when absent", async () => {
    const h = harness();
    const created = await new CreateModel(h).execute({
      name: "related-products",
      strategy: "related",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetModel(h).execute({ modelId: created.value.modelId });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.name).toBe("related-products");

    const missing = await new GetModel(h).execute({ modelId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
