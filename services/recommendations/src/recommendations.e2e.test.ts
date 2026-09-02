import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireRecommendations } from "./composition";
import { InMemorySearchQueryPort } from "./infrastructure/in-memory-port-adapters";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire(search = new InMemorySearchQueryPort()) {
  return wireRecommendations({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    search,
  });
}

async function newActiveModelId(app: ReturnType<typeof wire>): Promise<string> {
  const created = await app.recommendations.create({
    name: "related-products",
    strategy: "related",
  });
  expect(created.status).toBe(201);
  const id = (created.body as { modelId: string }).modelId;
  await app.recommendations.advance({ modelId: id, toStatus: "training" });
  await app.recommendations.advance({ modelId: id, toStatus: "active" });
  return id;
}

describe("recommendations (end to end)", () => {
  it("runs the full lifecycle: create -> train -> activate -> generate, publishing canonical events", async () => {
    const search = new InMemorySearchQueryPort();
    search.seedRelated("product-1", ["product-2", "product-3"]);
    const app = wire(search);
    const id = await newActiveModelId(app);

    const generated = await app.recommendations.generate({
      modelId: id,
      interactionId: "interaction-1",
      anchorRef: "product-1",
    });
    expect(generated.status).toBe(200);
    expect((generated.body as { setCount: number }).setCount).toBe(1);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("recommendations.model.active");
    expect(app.deliveredEventTypes).toContain("recommendations.set.generated");
  });

  it("generation is replay-safe by interactionId", async () => {
    const app = wire();
    const id = await newActiveModelId(app);
    await app.recommendations.generate({
      modelId: id,
      interactionId: "interaction-shared",
      anchorRef: "product-1",
    });
    const replay = await app.recommendations.generate({
      modelId: id,
      interactionId: "interaction-shared",
      anchorRef: "product-1",
    });
    expect(replay.status).toBe(200);
    expect((replay.body as { setCount: number }).setCount).toBe(1);
  });

  it("regenerate overwrites the set for an anchor", async () => {
    const search = new InMemorySearchQueryPort();
    const app = wire(search);
    const id = await newActiveModelId(app);
    search.seedRelated("product-1", ["product-2"]);
    await app.recommendations.generate({
      modelId: id,
      interactionId: "interaction-1",
      anchorRef: "product-1",
    });
    search.seedRelated("product-1", ["product-4"]);
    const regenerated = await app.recommendations.regenerate({
      modelId: id,
      anchorRef: "product-1",
    });
    expect((regenerated.body as { setCount: number }).setCount).toBe(1);
  });

  it("rejects creating a duplicate model name (409)", async () => {
    const app = wire();
    await app.recommendations.create({ name: "related-products", strategy: "related" });
    const response = await app.recommendations.create({
      name: "related-products",
      strategy: "related",
    });
    expect(response.status).toBe(409);
  });

  it("rejects an invalid strategy (422)", async () => {
    const app = wire();
    const response = await app.recommendations.create({ name: "x", strategy: "invalid" });
    expect(response.status).toBe(422);
  });
});
