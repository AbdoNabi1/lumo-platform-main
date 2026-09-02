import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireExample } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-06-30T00:00:00.000Z") };

function wire() {
  return wireExample({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("example walking skeleton (end to end)", () => {
  it("flows API → application → domain → repository → outbox → messaging → consumer", async () => {
    const app = wire();

    const response = await app.controller.handle({ body: { label: "demo" } });
    expect(response.status).toBe(201);

    const published = await app.drainOutbox();
    expect(published).toBe(1);
    expect(app.consumer.handledLabels).toEqual(["demo"]);
  });

  it("rejects invalid input at the interface boundary (no event emitted)", async () => {
    const app = wire();

    const response = await app.controller.handle({ body: { label: "  " } });
    expect(response.status).toBe(400);
    expect(await app.drainOutbox()).toBe(0);
  });
});
