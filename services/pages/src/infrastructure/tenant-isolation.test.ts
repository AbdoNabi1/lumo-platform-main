import { describe, expect, it } from "vitest";
import type { TransactionClient } from "@platform/db";
import { createFakePrisma } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { tenantRowIsolationCases, type TenantRowStore } from "@platform/messaging/testing";
import { Page } from "../domain/page";
import type { PageRepository } from "../domain/repositories";
import { RoutePath } from "../domain/value-objects/route-path";
import { InMemoryPageRepository } from "./in-memory-repositories";
import { PagesEventTranslator } from "./pages-event-translator";
import { PrismaPageRepository } from "./prisma-repositories";

const now = new Date("2026-11-04T10:00:00.000Z");

interface Built {
  readonly tx: unknown;
  readonly pages: PageRepository;
}
interface Layer {
  readonly name: string;
  readonly make: () => Built;
}

function wiring() {
  let n = 0;
  const ids = { generate: () => `00000000-0000-7000-8000-${String((n += 1)).padStart(12, "0")}` };
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new PagesEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => now },
    producer: "pages",
  });
  return { outbox, context: rootEventContext(ids) };
}

const layers: Layer[] = [
  {
    name: "in-memory",
    make: () => ({ tx: undefined, pages: new InMemoryPageRepository(wiring()) }),
  },
  {
    name: "prisma (fake client)",
    make: () => {
      const fake = createFakePrisma();
      return {
        tx: fake.database as unknown as TransactionClient,
        pages: new PrismaPageRepository({ prisma: fake.database, ...wiring() }),
      };
    },
  },
];

/**
 * The store key maps to `/pages/k-<n>` (the same route under every shop, on purpose); each shop's
 * row has its own id, as in the database. `find` and `update` probe every id ever inserted under a
 * key, so a lookup that ignores the shop would reach another shop's row. The marker is `title.en`.
 */
function pageStore({ tx, pages }: Built): TenantRowStore {
  const keys: string[] = [];
  const ids = new Map<string, string>();
  const idsOfKey = new Map<string, string[]>();
  const indexOf = (key: string) => {
    let i = keys.indexOf(key);
    if (i < 0) i = keys.push(key) - 1;
    return i;
  };
  const content = (marker: string) => ({ title: { en: marker }, body: {}, metaDescription: {} });
  return {
    insert: async (tenantId, key, marker) => {
      const known = ids.get(`${tenantId}|${key}`);
      if (known !== undefined) {
        const page = await pages.findById(known, tenantId, tx);
        if (page === null) throw new Error("test setup: lost row");
        page.updateContent(content(marker), now);
        await pages.save(page, tenantId, tx);
        return;
      }
      const id = `00000000-0000-4000-8000-${String(ids.size).padStart(12, "0")}`;
      ids.set(`${tenantId}|${key}`, id);
      idsOfKey.set(key, [...(idsOfKey.get(key) ?? []), id]);
      const route = RoutePath.create(`/pages/k-${indexOf(key)}`);
      if (!route.ok) throw new Error("test setup: invalid route path");
      const page = Page.create(UniqueEntityId.from(id), "P", route.value, {}, content(marker), now);
      page.publish("e", now);
      await pages.save(page, tenantId, tx);
    },
    find: async (tenantId, key) =>
      (await pages.findByIds(idsOfKey.get(key) ?? [], tenantId, tx))[0]?.title.en ?? null,
    list: async (tenantId) =>
      (await pages.listPublished(tenantId, 500, tx)).map((p) => p.title.en ?? ""),
    update: async (tenantId, key, marker) => {
      const id = (idsOfKey.get(key) ?? [])[0];
      const page = id === undefined ? null : await pages.findById(id, tenantId, tx);
      if (page === null) throw new Error("not found");
      page.updateContent(content(marker), now);
      await pages.save(page, tenantId, tx);
    },
  };
}

for (const layer of layers) {
  describe(`pages tenant isolation - ${layer.name} (ADR-0014)`, () => {
    const cases = tenantRowIsolationCases({
      context: "pages/pages",
      layer: layer.name,
      make: () => pageStore(layer.make()),
    });
    for (const c of cases) it(c.name, c.run);
  });
}

describe("PrismaPageRepository.listPublished (fake client)", () => {
  it("never returns another shop's rows", async () => {
    const built = layers[1]!.make();
    await pageStore(built).insert("t-1", "a", "mine");
    expect(await built.pages.listPublished("t-2", 500, built.tx)).toEqual([]);
    const own = await built.pages.listPublished("t-1", 500, built.tx);
    expect(own.map((p) => p.title.en)).toEqual(["mine"]);
  });
});
