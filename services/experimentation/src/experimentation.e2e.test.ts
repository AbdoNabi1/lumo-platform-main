import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireExperimentation } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wireExperimentation({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

function createInput() {
  return {
    name: "Checkout button color",
    variants: [
      { key: "control", allocationPercentage: 50, isControl: true },
      { key: "treatment", allocationPercentage: 50, isControl: false },
    ],
    goalMetricRef: "conversion_rate",
    tenantId: "tenant-local",
  };
}

describe("experimentation (end to end)", () => {
  it("runs the full lifecycle: create -> start -> record results -> declare winner, publishing canonical events", async () => {
    const app = wire();
    const created = await app.experimentation.create(createInput());
    expect(created.status).toBe(201);
    const experimentId = (created.body as { experimentId: string }).experimentId;

    const started = await app.experimentation.advance({
      experimentId,
      toStatus: "running",
      tenantId: "tenant-local",
    });
    expect(started.status).toBe(200);

    await app.experimentation.recordResult({
      experimentId,
      variantKey: "control",
      metricValue: 0.1,
      sampleSize: 1000,
      tenantId: "tenant-local",
    });
    await app.experimentation.recordResult({
      experimentId,
      variantKey: "treatment",
      metricValue: 0.15,
      sampleSize: 1000,
      tenantId: "tenant-local",
    });

    const winner = await app.experimentation.declareWinner({
      experimentId,
      variantKey: "treatment",
      tenantId: "tenant-local",
    });
    expect(winner.status).toBe(200);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("experiment.experiment.started");
    expect(app.deliveredEventTypes).toContain("experiment.result.recorded");
    expect(app.deliveredEventTypes).toContain("experiment.winner.declared");
  });

  it("rejects variant allocations that don't sum to 100 (422)", async () => {
    const app = wire();
    const response = await app.experimentation.create({
      ...createInput(),
      variants: [{ key: "control", allocationPercentage: 60, isControl: true }],
    });
    expect(response.status).toBe(422);
  });

  it("rejects creating a duplicate experiment name (409)", async () => {
    const app = wire();
    await app.experimentation.create(createInput());
    const response = await app.experimentation.create(createInput());
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown experiment", async () => {
    const app = wire();
    const response = await app.experimentation.advance({
      experimentId: "missing",
      toStatus: "running",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(404);
  });
});
