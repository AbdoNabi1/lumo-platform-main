import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { GetIndex } from "./get-index.use-case";
import { ListIndexes } from "./list-indexes.use-case";
import { CreateIndex } from "./search.use-cases";
import { InMemorySearchIndexRepository } from "../infrastructure/in-memory-search-index-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { SearchEventTranslator } from "../infrastructure/search-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new SearchEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "search",
  });
  const context = rootEventContext(sequentialIds());
  const indexes = new InMemorySearchIndexRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { indexes, unitOfWork, idGenerator, clock };
}

describe("Search read use-cases (Phase 4 T4.3)", () => {
  it("ListIndexes paginates", async () => {
    const h = harness();
    const create = new CreateIndex(h);
    for (let i = 0; i < 3; i += 1) {
      await create.execute({ name: `index-${i}` });
    }

    const page = await new ListIndexes(h).execute({ first: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await new ListIndexes(h).execute({
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("GetIndex returns the index, or NotFoundError when absent", async () => {
    const h = harness();
    const created = await new CreateIndex(h).execute({ name: "products" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetIndex(h).execute({ indexId: created.value.indexId });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.id.toString()).toBe(created.value.indexId);

    const missing = await new GetIndex(h).execute({ indexId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
