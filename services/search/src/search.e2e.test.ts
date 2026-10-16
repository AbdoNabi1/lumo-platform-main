import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSearch } from "./composition";
import { InMemoryIndexProvider } from "./infrastructure/in-memory-index-provider";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire(provider = new InMemoryIndexProvider()) {
  return wireSearch({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    provider,
  });
}

async function newIndexId(app: ReturnType<typeof wire>): Promise<string> {
  const created = await app.search.create({ name: "products", tenantId: "tenant-local" });
  expect(created.status).toBe(201);
  return (created.body as { indexId: string }).indexId;
}

describe("search (end to end)", () => {
  it("runs the full lifecycle: create -> upsert -> synonym -> query, publishing canonical events", async () => {
    const provider = new InMemoryIndexProvider();
    const app = wire(provider);
    const id = await newIndexId(app);

    const upserted = await app.search.upsertDocument({
      indexId: id,
      productRef: "product-1",
      title: "Running shoes",
      categoryRefs: ["footwear"],
      tenantId: "tenant-local",
    });
    expect(upserted.status).toBe(200);
    expect((upserted.body as { documentCount: number }).documentCount).toBe(1);
    expect(provider.indexedDocuments).toHaveLength(1);

    await app.search.addSynonym({
      indexId: id,
      term: "shoe",
      synonyms: ["sneaker"],
      tenantId: "tenant-local",
    });
    await app.search.logQuery({ indexId: id, term: "running shoes", tenantId: "tenant-local" });

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("search.document.upserted");
    expect(app.deliveredEventTypes).toContain("search.synonyms.added");
    expect(app.deliveredEventTypes).toContain("search.query.logged");
  });

  it("deletes a document", async () => {
    const provider = new InMemoryIndexProvider();
    const app = wire(provider);
    const id = await newIndexId(app);
    await app.search.upsertDocument({
      indexId: id,
      productRef: "product-1",
      title: "Running shoes",
      categoryRefs: [],
      tenantId: "tenant-local",
    });
    const deleted = await app.search.deleteDocument({
      indexId: id,
      productRef: "product-1",
      tenantId: "tenant-local",
    });
    expect((deleted.body as { documentCount: number }).documentCount).toBe(0);
    expect(provider.indexedDocuments).toHaveLength(0);
  });

  it("rejects creating a duplicate index name (409)", async () => {
    const app = wire();
    await newIndexId(app);
    const response = await app.search.create({ name: "products", tenantId: "tenant-local" });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown index", async () => {
    const app = wire();
    const response = await app.search.advance({
      indexId: "missing",
      toStatus: "disabled",
      tenantId: "tenant-local",
    });
    expect(response.status).toBe(404);
  });

  it("rejects an empty index name (422)", async () => {
    const app = wire();
    const response = await app.search.create({ name: "", tenantId: "tenant-local" });
    expect(response.status).toBe(422);
  });
});
