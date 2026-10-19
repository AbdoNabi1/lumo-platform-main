import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { parseTags } from "../domain/order-tags";
import { InMemoryOrderAnnotationRepository } from "./in-memory-order-annotation-repository";
import { InMemoryOrderRepository } from "./in-memory-order-repository";
import {
  ARCHIVED_FIXTURE_KEYS,
  buildListFixture,
  ORDER_LIST_CASES,
  TAGGED_FIXTURE,
  type ListFixtureKey,
} from "./order-list-fixture";
import { OrderEventTranslator } from "./order-event-translator";

const TENANT = "tenant-views";

async function seeded() {
  let n = 0;
  const nextId = () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
  const repository = new InMemoryOrderRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new OrderEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "orders",
    }),
    context: rootEventContext({ generate: nextId }),
  });
  const fixture = buildListFixture(nextId);
  for (const { order } of fixture) await repository.save(order, TENANT);
  const idOf = (key: ListFixtureKey) => {
    const found = fixture.find((entry) => entry.key === key);
    if (found === undefined) throw new Error(`no fixture order ${key}`);
    return found.order.id.toString();
  };
  for (const key of ARCHIVED_FIXTURE_KEYS) {
    repository.writeArchivedAt(idOf(key), TENANT, new Date("2026-10-18T00:00:00.000Z"));
  }
  for (const [key, tags] of Object.entries(TAGGED_FIXTURE) as [
    ListFixtureKey,
    readonly string[],
  ][]) {
    const parsed = parseTags(tags);
    if (!parsed.ok) throw new Error("fixture tags");
    repository.writeTags(idOf(key), TENANT, parsed.value);
  }
  const keyOf = (id: string) => fixture.find((entry) => entry.order.id.toString() === id)?.key;
  return { repository, idOf, keyOf };
}

describe("InMemoryOrderRepository list views (shared cases, order operations Part 1)", () => {
  for (const listCase of ORDER_LIST_CASES) {
    it(listCase.name, async () => {
      const { repository, idOf, keyOf } = await seeded();
      const page = await repository.list({ ...listCase.query(idOf), first: 100 }, TENANT);
      expect(page.items.map((order) => keyOf(order.id.toString())).sort()).toEqual(
        [...listCase.expected].sort(),
      );
    });
  }

  it("save() never clears an archive timestamp", async () => {
    const { repository, idOf } = await seeded();
    const id = idOf("archivedUnpaid");
    const order = await repository.findById(id, TENANT);
    if (order === null) throw new Error("setup");
    await repository.save(order, TENANT);
    expect(repository.archivedAtOf(id, TENANT)).toEqual(new Date("2026-10-18T00:00:00.000Z"));
  });

  it("writeArchivedAt refuses an order this shop does not have", async () => {
    const { repository, idOf } = await seeded();
    expect(repository.writeArchivedAt(idOf("paid"), "another-shop", new Date())).toBe(false);
    expect(repository.archivedAtOf(idOf("paid"), "another-shop")).toBeNull();
  });

  it("save() never clears a note or tags (Part 2)", async () => {
    const { repository, idOf } = await seeded();
    const id = idOf("openUnpaid");
    repository.writeNote(id, TENANT, "Ring twice");
    const order = await repository.findById(id, TENANT);
    if (order === null) throw new Error("setup");
    await repository.save(order, TENANT);
    expect(repository.noteOf(id, TENANT)).toBe("Ring twice");
    expect(repository.tagsOf(id, TENANT).map((tag) => tag.tag)).toEqual(["VIP", "Urgent"]);
  });

  it("tagsInUse matches a typed prefix literally — '%' is not a wildcard (Review Focus 1)", async () => {
    const { repository, idOf } = await seeded();
    const annotations = new InMemoryOrderAnnotationRepository({ orders: repository });
    await annotations.addTags([idOf("paid")], [{ tag: "50% off", tagKey: "50% off" }], TENANT);
    expect(await annotations.tagsInUse(TENANT, "%")).toEqual([]);
    expect(await annotations.tagsInUse(TENANT, "50%")).toEqual([{ tag: "50% off", count: 1 }]);
    expect(await annotations.tagsInUse(TENANT, "v")).toEqual([{ tag: "VIP", count: 2 }]);
  });
});
