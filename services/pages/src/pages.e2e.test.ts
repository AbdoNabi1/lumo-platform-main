import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wirePages } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wirePages({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("pages (end to end)", () => {
  it("runs the full lifecycle: create template -> create page -> publish, publishing canonical events", async () => {
    const app = wire();
    const template = await app.pages.createTemplate({
      name: "Product page",
      experienceRef: "experience-1",
    });
    expect(template.status).toBe(201);

    const page = await app.pages.createPage({
      name: "Product detail",
      routePath: "/products/:slug",
      templateRef: "template-1",
    });
    expect(page.status).toBe(201);
    const pageId = (page.body as { pageId: string }).pageId;

    const published = await app.pages.advancePage({ pageId, toStatus: "published" });
    expect(published.status).toBe(200);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("pages.page.published");
  });

  it("rejects creating a duplicate route path (409)", async () => {
    const app = wire();
    await app.pages.createPage({ name: "Home", routePath: "/" });
    const response = await app.pages.createPage({ name: "Home 2", routePath: "/" });
    expect(response.status).toBe(409);
  });

  it("rejects an invalid route path (422)", async () => {
    const app = wire();
    const response = await app.pages.createPage({ name: "Bad", routePath: "Products" });
    expect(response.status).toBe(422);
  });
});
