import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireComponents } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wireComponents({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

function createInput() {
  return {
    key: "hero",
    name: "Hero",
    properties: [{ name: "title", type: "string" as const, required: true }],
    slots: ["content"],
    events: ["onClick"],
    responsive: true,
    tenantId: "tenant-local",
  };
}

describe("components (end to end)", () => {
  it("runs the full lifecycle: create -> publish, publishing canonical events", async () => {
    const app = wire();
    const created = await app.components.create(createInput());
    expect(created.status).toBe(201);
    const componentDefinitionId = (created.body as { componentDefinitionId: string })
      .componentDefinitionId;

    const published = await app.components.advance({
      componentDefinitionId,
      toStatus: "published",
      tenantId: "tenant-local",
    });
    expect(published.status).toBe(200);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("components.component_definition.published");
  });

  it("rejects creating a duplicate key (409)", async () => {
    const app = wire();
    await app.components.create(createInput());
    const response = await app.components.create(createInput());
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown component", async () => {
    const app = wire();
    const response = await app.components.advance({
      componentDefinitionId: "missing",
      toStatus: "published",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(404);
  });
});
