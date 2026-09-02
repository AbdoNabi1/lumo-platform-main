import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireContent } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wireContent({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("content (end to end)", () => {
  it("runs the full lifecycle: create -> publish, publishing canonical events", async () => {
    const app = wire();
    const created = await app.content.create({
      name: "Homepage hero",
      blockType: "hero",
      format: "html",
      content: "<h1>Welcome</h1>",
    });
    expect(created.status).toBe(201);
    const contentBlockId = (created.body as { contentBlockId: string }).contentBlockId;

    const published = await app.content.advance({ contentBlockId, toStatus: "published" });
    expect(published.status).toBe(200);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("content.content_block.published");
  });

  it("rejects creating a duplicate name (409)", async () => {
    const app = wire();
    await app.content.create({ name: "Hero", blockType: "hero", format: "html", content: "<p/>" });
    const response = await app.content.create({
      name: "Hero",
      blockType: "hero",
      format: "html",
      content: "<p/>",
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown content block", async () => {
    const app = wire();
    const response = await app.content.advance({
      contentBlockId: "missing",
      toStatus: "published",
    });
    expect(response.status).toBe(404);
  });
});
