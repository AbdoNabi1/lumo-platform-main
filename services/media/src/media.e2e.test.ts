import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireMedia } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-06-30T00:00:00.000Z") };

function wire() {
  return wireMedia({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("media (end to end)", () => {
  it("registers an asset and emits media.asset.ready via the outbox", async () => {
    const app = wire();

    const response = await app.assets.register({
      storageKey: "uploads/a.png",
      contentType: "image/png",
    });
    expect(response.status).toBe(201);

    expect(await app.drainOutbox()).toBe(1);
    expect(app.deliveredEventTypes).toContain("media.asset.ready");
  });

  it("rejects an invalid content type at the boundary (422)", async () => {
    const app = wire();
    const response = await app.assets.register({
      storageKey: "uploads/a.png",
      contentType: "not-a-mime",
    });
    expect(response.status).toBe(422);
  });
});
