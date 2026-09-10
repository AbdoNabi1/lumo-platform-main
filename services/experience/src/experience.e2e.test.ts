import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireExperience } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wireExperience({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("experience (end to end)", () => {
  it("runs the full lifecycle: create -> update canvas -> publish, publishing canonical events", async () => {
    const app = wire();
    const created = await app.experience.create({
      name: "Homepage",
      experienceType: "storefront",
      tenantId: "tenant-local",
    });
    expect(created.status).toBe(201);
    const experienceId = (created.body as { experienceId: string }).experienceId;

    const updated = await app.experience.updateCanvas({
      experienceId,
      sections: [{ key: "hero", slots: [{ key: "content", componentInstances: [] }] }],
      tenantId: "tenant-local",
    });
    expect(updated.status).toBe(200);

    const published = await app.experience.advance({
      experienceId,
      toStatus: "published",
      tenantId: "tenant-local",
    });
    expect(published.status).toBe(200);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("experience.experience.published");
  });

  it("rejects creating a duplicate name (409)", async () => {
    const app = wire();
    await app.experience.create({
      name: "Homepage",
      experienceType: "storefront",
      tenantId: "tenant-local",
    });
    const response = await app.experience.create({
      name: "Homepage",
      experienceType: "storefront",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown experience", async () => {
    const app = wire();
    const response = await app.experience.advance({
      experienceId: "missing",
      toStatus: "published",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(404);
  });
});
