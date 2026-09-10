import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireTheme } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wireTheme({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("theme (end to end)", () => {
  it("runs the full lifecycle: create (seeded from design tokens) -> publish, publishing canonical events", async () => {
    const app = wire();
    const created = await app.theme.create({
      name: "Default",
      presetKey: "default",
      tenantId: "tenant-local",
    });
    expect(created.status).toBe(201);
    const themeId = (created.body as { themeId: string }).themeId;

    const published = await app.theme.advance({
      themeId,
      toStatus: "active",
      tenantId: "tenant-local",
    });
    expect(published.status).toBe(200);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("theme.theme.active");
  });

  it("rejects creating a duplicate theme name (409)", async () => {
    const app = wire();
    await app.theme.create({ name: "Default", presetKey: "default", tenantId: "tenant-local" });
    const response = await app.theme.create({
      name: "Default",
      presetKey: "dark",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown theme", async () => {
    const app = wire();
    const response = await app.theme.advance({
      themeId: "missing",
      toStatus: "active",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(404);
  });
});
