import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { MAX_NOTE_LENGTH, MAX_TAGS_PER_ORDER, type OrderTag } from "../domain/order-tags";
import type { OrderTimelineEntry, OrderTimelineRepository } from "../domain/order-timeline";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { InMemoryOrderAnnotationRepository } from "../infrastructure/in-memory-order-annotation-repository";
import { InMemoryOrderRepository } from "../infrastructure/in-memory-order-repository";
import { InMemoryOrderTimelineRepository } from "../infrastructure/in-memory-order-timeline-repository";
import { InMemoryStaffDirectory } from "../infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { OrderEventTranslator } from "../infrastructure/order-event-translator";
import {
  AddOrderTags,
  ArchiveOrders,
  RemoveOrderTags,
  SuggestOrderTags,
  UnarchiveOrders,
  UpdateOrderNote,
} from "./order-annotations.use-cases";

const TENANT = "tenant-a";
const NOW = new Date("2026-10-19T09:00:00.000Z");

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function placed(id: string): Order {
  const item = OrderItem.create(
    UniqueEntityId.from(`${id}-item`),
    must(ProductSnapshot.create("p-1", "Toy", must(Money.create(500, "EGP")))),
    1,
  );
  return Order.place(
    UniqueEntityId.from(id),
    must(OrderNumber.create(id)),
    "customer-1",
    "EGP",
    [item],
    must(AddressSnapshot.create("1 Nile St", "Cairo", "11511", "EG")),
    `${id}-evt`,
    new Date(0),
  );
}

/** A unit of work that hands its work the transaction "tx-1" — to prove where activity is written. */
const recordingUnitOfWork: TransactionalUnitOfWork<unknown> = {
  run: async (work) => work("tx-1"),
};

class TxRecordingTimeline extends InMemoryOrderTimelineRepository {
  readonly seenTx: unknown[] = [];

  override async append(entry: OrderTimelineEntry, tenantId: string, tx?: unknown): Promise<void> {
    this.seenTx.push(tx);
    return super.append(entry, tenantId);
  }
}

/**
 * A tag store where another transaction commits `racing` on every order between this call's read
 * and its insert — the race a READ COMMITTED Postgres allows (Task 2 review, carried requirement 3).
 */
class RacingAnnotations extends InMemoryOrderAnnotationRepository {
  racing: readonly OrderTag[] = [];

  override async addTags(
    orderIds: readonly string[],
    tags: readonly OrderTag[],
    tenantId: string,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    if (this.racing.length > 0) await super.addTags(orderIds, this.racing, tenantId);
    return super.addTags(orderIds, tags, tenantId);
  }
}

async function wire(
  orderIds: readonly string[] = ["o-1", "o-2"],
  options: {
    readonly unitOfWork?: TransactionalUnitOfWork<unknown>;
    readonly timeline?: OrderTimelineRepository;
  } = {},
) {
  const orders = new InMemoryOrderRepository({
    outbox: new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new OrderEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "orders",
    }),
    context: rootEventContext({ generate: () => "evt" }),
  });
  for (const id of orderIds) await orders.save(placed(id), TENANT);
  await orders.save(placed("theirs"), "tenant-b");
  const annotations = new RacingAnnotations({ orders });
  const timeline = options.timeline ?? new InMemoryOrderTimelineRepository();
  const staff = new InMemoryStaffDirectory({ "staff-1": "Ahmed" });
  let n = 0;
  const deps = {
    annotations,
    unitOfWork: options.unitOfWork ?? new InMemoryUnitOfWork(),
    clock: { now: () => NOW },
    activity: { timeline, staff, idGenerator: { generate: () => `entry-${(n += 1)}` } },
  };
  return {
    orders,
    annotations,
    staff,
    note: new UpdateOrderNote(deps),
    addTags: new AddOrderTags(deps),
    removeTags: new RemoveOrderTags(deps),
    suggest: new SuggestOrderTags({ annotations }),
    archive: new ArchiveOrders(deps),
    unarchive: new UnarchiveOrders(deps),
    linesOf: async (orderId: string, tenantId = TENANT) =>
      (await timeline.listForOrder(orderId, tenantId, { first: 200 })).map((entry) => ({
        kind: entry.kind,
        authorName: entry.authorName,
        data: entry.data,
      })),
  };
}

const noteInput = (note: string | null, orderId = "o-1") => ({
  tenantId: TENANT,
  orderId,
  note,
  actorRef: "staff-1",
});
const tagInput = (orderIds: readonly string[], tags: readonly string[]) => ({
  tenantId: TENANT,
  orderIds,
  tags,
  actorRef: "staff-1",
});

describe("UpdateOrderNote (order operations Part 2)", () => {
  it("saves the trimmed note and writes one note_changed line by the actor's name", async () => {
    const { note, annotations, linesOf } = await wire();
    const result = await note.execute(noteInput("  Ring twice  "));
    expect(result).toEqual({
      ok: true,
      value: { orderId: "o-1", note: "Ring twice", changed: true },
    });
    expect((await annotations.annotationsOf(["o-1"], TENANT)).get("o-1")?.note).toBe("Ring twice");
    expect(await linesOf("o-1")).toEqual([
      { kind: "note_changed", authorName: "Ahmed", data: { cleared: false } },
    ]);
  });

  it("whitespace-only clears the note; saving the same note twice writes no second line (Review Focus 2)", async () => {
    const { note, annotations, linesOf } = await wire();
    await note.execute(noteInput("Ring twice"));
    const same = await note.execute(noteInput(" Ring twice "));
    expect(same.ok && same.value.changed).toBe(false);
    const cleared = await note.execute(noteInput("   \n "));
    expect(cleared).toEqual({ ok: true, value: { orderId: "o-1", note: null, changed: true } });
    expect((await annotations.annotationsOf(["o-1"], TENANT)).get("o-1")?.note).toBeNull();
    expect((await linesOf("o-1")).map((line) => line.data)).toEqual([
      { cleared: true },
      { cleared: false },
    ]);
  });

  it("refuses 5,001 characters and writes nothing", async () => {
    const { note, annotations, linesOf } = await wire();
    const result = await note.execute(noteInput("a".repeat(MAX_NOTE_LENGTH + 1)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    expect((await annotations.annotationsOf(["o-1"], TENANT)).get("o-1")?.note).toBeNull();
    expect(await linesOf("o-1")).toEqual([]);
  });

  it("answers NOT_FOUND for another shop's order and writes no line in either shop (carried 2)", async () => {
    const { note, annotations, linesOf } = await wire();
    for (const orderId of ["theirs", "missing"]) {
      const result = await note.execute(noteInput("x", orderId));
      expect(!result.ok && result.error.code).toBe("NOT_FOUND");
      expect(await linesOf(orderId)).toEqual([]);
    }
    expect(await linesOf("theirs", "tenant-b")).toEqual([]);
    expect(
      (await annotations.annotationsOf(["theirs"], "tenant-b")).get("theirs")?.note,
    ).toBeNull();
  });

  it("writes the activity line inside the note's own transaction", async () => {
    const timeline = new TxRecordingTimeline();
    const { note } = await wire(["o-1"], { unitOfWork: recordingUnitOfWork, timeline });
    await note.execute(noteInput("Ring twice"));
    expect(timeline.seenTx).toEqual(["tx-1"]);
  });

  it("never touches the Order aggregate: same version, same history", async () => {
    const { note, orders } = await wire();
    const before = await orders.findById("o-1", TENANT);
    await note.execute(noteInput("Ring twice"));
    const after = await orders.findById("o-1", TENANT);
    expect(after?.version).toBe(before?.version);
    expect(after?.history).toHaveLength(before?.history.length ?? -1);
  });
});

describe("AddOrderTags / RemoveOrderTags (order operations Part 2)", () => {
  it("adds normalized, de-duplicated tags to every order and reports what each one gained", async () => {
    const { addTags, linesOf } = await wire();
    await addTags.execute(tagInput(["o-1"], ["VIP"]));
    const result = await addTags.execute(tagInput(["o-1", "o-2"], ["vip, Urgent", " urgent "]));
    expect(result.ok && result.value.results).toEqual([
      { orderId: "o-1", outcome: "changed", tags: ["Urgent", "VIP"], changedTags: ["Urgent"] },
      {
        orderId: "o-2",
        outcome: "changed",
        tags: ["Urgent", "vip"],
        changedTags: ["vip", "Urgent"],
      },
    ]);
    expect(await linesOf("o-1")).toEqual([
      { kind: "tags_added", authorName: "Ahmed", data: { tags: ["Urgent"] } },
      { kind: "tags_added", authorName: "Ahmed", data: { tags: ["VIP"] } },
    ]);
  });

  it("an order that already carries every tag (any case) is unchanged and gets no line", async () => {
    const { addTags, linesOf } = await wire();
    await addTags.execute(tagInput(["o-1"], ["VIP"]));
    const again = await addTags.execute(tagInput(["o-1"], ["vip"]));
    expect(again.ok && again.value.results).toEqual([
      { orderId: "o-1", outcome: "unchanged", tags: ["VIP"], changedTags: [] },
    ]);
    expect(await linesOf("o-1")).toHaveLength(1);
  });

  it("refuses to push an order past 250 tags — nothing added to it — while the others are tagged (Review Focus 3)", async () => {
    const { addTags, annotations, linesOf } = await wire();
    const full = Array.from({ length: MAX_TAGS_PER_ORDER - 1 }, (_, i) => `tag-${i}`);
    await addTags.execute(tagInput(["o-1"], full));
    const result = await addTags.execute(tagInput(["o-1", "o-2"], ["new-a", "new-b"]));
    expect(result.ok && result.value.results.map((r) => [r.orderId, r.outcome])).toEqual([
      ["o-1", "too_many_tags"],
      ["o-2", "changed"],
    ]);
    expect((await annotations.annotationsOf(["o-1"], TENANT)).get("o-1")?.tags).toHaveLength(
      MAX_TAGS_PER_ORDER - 1,
    );
    expect(await linesOf("o-1")).toHaveLength(1);
    const exactlyFull = await addTags.execute(tagInput(["o-1"], ["new-a"]));
    expect(exactlyFull.ok && exactlyFull.value.results[0]?.outcome).toBe("changed");
    expect((await annotations.annotationsOf(["o-1"], TENANT)).get("o-1")?.tags).toHaveLength(
      MAX_TAGS_PER_ORDER,
    );
  });

  it("refuses a single-order add past 250 tags with a VALIDATION error, writing nothing (carried 1)", async () => {
    const { addTags, annotations, linesOf } = await wire();
    const full = Array.from({ length: MAX_TAGS_PER_ORDER }, (_, i) => `tag-${i}`);
    expect((await addTags.execute(tagInput(["o-1"], full))).ok).toBe(true);
    // Tags it already carries do not count twice: re-adding one at the cap is just unchanged.
    const known = await addTags.execute(tagInput(["o-1"], ["TAG-0"]));
    expect(known.ok && known.value.results[0]?.outcome).toBe("unchanged");
    const result = await addTags.execute(tagInput(["o-1"], ["tag-0", "one-more"]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toMatch(/250/);
    }
    const tags = (await annotations.annotationsOf(["o-1"], TENANT)).get("o-1")?.tags ?? [];
    expect(tags).toHaveLength(MAX_TAGS_PER_ORDER);
    expect(tags).not.toContain("one-more");
    expect(await linesOf("o-1")).toHaveLength(1);
  });

  it("refuses more than 250 distinct tags in one request", async () => {
    const { addTags } = await wire();
    const tooMany = Array.from({ length: MAX_TAGS_PER_ORDER + 1 }, (_, i) => `t${i}`);
    const result = await addTags.execute(tagInput(["o-1"], tooMany));
    expect(!result.ok && result.error.code).toBe("VALIDATION");
  });

  it("answers not_found for unknown and other shops' ids, tags the rest, and writes no line for them (carried 2)", async () => {
    const { addTags, removeTags, annotations, linesOf } = await wire();
    const result = await addTags.execute(tagInput(["o-1", "missing", "theirs"], ["vip"]));
    expect(result.ok && result.value.results.map((r) => r.outcome)).toEqual([
      "changed",
      "not_found",
      "not_found",
    ]);
    await removeTags.execute(tagInput(["theirs"], ["vip"]));
    for (const orderId of ["missing", "theirs"]) expect(await linesOf(orderId)).toEqual([]);
    expect(await linesOf("theirs", "tenant-b")).toEqual([]);
    expect((await annotations.annotationsOf(["theirs"], "tenant-b")).get("theirs")?.tags).toEqual(
      [],
    );
  });

  it("refuses 0 or 51 orders, no tags, and a tag over 40 characters — writing nothing", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `o-${i}`);
    const { addTags, annotations } = await wire(ids);
    for (const input of [
      tagInput([], ["vip"]),
      tagInput(ids, ["vip"]),
      tagInput(["o-0"], [" ", ","]),
      tagInput(["o-0"], ["ok", "x".repeat(41)]),
    ]) {
      const result = await addTags.execute(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    }
    expect((await annotations.annotationsOf(["o-0"], TENANT)).get("o-0")?.tags).toEqual([]);
  });

  it("records only the tags this call actually inserted when a concurrent add wins a race (carried 3)", async () => {
    const { addTags, annotations, linesOf } = await wire();
    annotations.racing = [{ tag: "VIP", tagKey: "vip" }];
    const result = await addTags.execute(tagInput(["o-1"], ["vip", "Urgent"]));
    expect(result.ok && result.value.results).toEqual([
      { orderId: "o-1", outcome: "changed", tags: ["Urgent", "VIP"], changedTags: ["Urgent"] },
    ]);
    expect(await linesOf("o-1")).toEqual([
      { kind: "tags_added", authorName: "Ahmed", data: { tags: ["Urgent"] } },
    ]);
    // The other writer inserted everything first: nothing was added here, so no line at all.
    annotations.racing = [{ tag: "Late", tagKey: "late" }];
    const lost = await addTags.execute(tagInput(["o-2"], ["late"]));
    expect(lost.ok && lost.value.results[0]?.outcome).toBe("unchanged");
    expect(await linesOf("o-2")).toEqual([]);
  });

  it("removes case-insensitively and records the stored spelling; nothing to remove is unchanged", async () => {
    const { addTags, removeTags, linesOf } = await wire();
    await addTags.execute(tagInput(["o-1"], ["VIP", "Urgent"]));
    const result = await removeTags.execute(tagInput(["o-1", "o-2"], ["vip"]));
    expect(result.ok && result.value.results).toEqual([
      { orderId: "o-1", outcome: "changed", tags: ["Urgent"], changedTags: ["VIP"] },
      { orderId: "o-2", outcome: "unchanged", tags: [], changedTags: [] },
    ]);
    expect((await linesOf("o-1"))[0]).toEqual({
      kind: "tags_removed",
      authorName: "Ahmed",
      data: { tags: ["VIP"] },
    });
  });

  it("writes tag lines inside the tag change's own transaction", async () => {
    const timeline = new TxRecordingTimeline();
    const { addTags } = await wire(["o-1"], { unitOfWork: recordingUnitOfWork, timeline });
    await addTags.execute(tagInput(["o-1"], ["vip"]));
    expect(timeline.seenTx).toEqual(["tx-1"]);
  });
});

describe("SuggestOrderTags", () => {
  it("answers the shop's tags by prefix, most used first", async () => {
    const { addTags, suggest } = await wire();
    await addTags.execute(tagInput(["o-1", "o-2"], ["VIP"]));
    await addTags.execute(tagInput(["o-1"], ["Village"]));
    expect(await suggest.execute({ tenantId: TENANT, prefix: " vi " })).toEqual({
      ok: true,
      value: {
        tags: [
          { tag: "VIP", count: 2 },
          { tag: "Village", count: 1 },
        ],
      },
    });
  });

  it("answers nothing for a prefix longer than any tag can be", async () => {
    const { suggest } = await wire();
    expect(await suggest.execute({ tenantId: TENANT, prefix: "x".repeat(41) })).toEqual({
      ok: true,
      value: { tags: [] },
    });
  });
});

describe("ArchiveOrders / UnarchiveOrders activity (Part 2 extends Part 1)", () => {
  it("writes archived / unarchived lines only for orders that changed", async () => {
    const { archive, unarchive, linesOf } = await wire();
    await archive.execute({ tenantId: TENANT, orderIds: ["o-1"], actorRef: "staff-1" });
    await archive.execute({ tenantId: TENANT, orderIds: ["o-1", "o-2"], actorRef: "staff-1" });
    await unarchive.execute({ tenantId: TENANT, orderIds: ["o-1"], actorRef: "staff-1" });
    expect((await linesOf("o-1")).map((line) => line.kind)).toEqual(["unarchived", "archived"]);
    expect((await linesOf("o-2")).map((line) => line.kind)).toEqual(["archived"]);
  });

  it("writes no line for an unknown or another shop's order (carried 2)", async () => {
    const { archive, linesOf } = await wire();
    await archive.execute({
      tenantId: TENANT,
      orderIds: ["missing", "theirs"],
      actorRef: "staff-1",
    });
    for (const orderId of ["missing", "theirs"]) expect(await linesOf(orderId)).toEqual([]);
    expect(await linesOf("theirs", "tenant-b")).toEqual([]);
  });

  it("writes archive lines inside the archive's own transaction", async () => {
    const timeline = new TxRecordingTimeline();
    const { archive } = await wire(["o-1"], { unitOfWork: recordingUnitOfWork, timeline });
    await archive.execute({ tenantId: TENANT, orderIds: ["o-1"], actorRef: "staff-1" });
    expect(timeline.seenTx).toEqual(["tx-1"]);
  });

  it("an unknown staff member is recorded with no name (shown as Staff)", async () => {
    const { archive, linesOf } = await wire();
    await archive.execute({ tenantId: TENANT, orderIds: ["o-1"], actorRef: "staff-unknown" });
    expect((await linesOf("o-1"))[0]?.authorName).toBeNull();
  });

  it("snapshots the name: renaming the staff member later keeps the line as written", async () => {
    const { archive, staff, linesOf } = await wire();
    await archive.execute({ tenantId: TENANT, orderIds: ["o-1"], actorRef: "staff-1" });
    staff.setName("staff-1", "Ahmed M.");
    expect((await linesOf("o-1"))[0]?.authorName).toBe("Ahmed");
  });

  it("a failing staff directory never blocks the action: the line has no name", async () => {
    const { archive, staff, linesOf } = await wire();
    staff.displayNameOf = async () => {
      throw new Error("directory down");
    };
    const result = await archive.execute({
      tenantId: TENANT,
      orderIds: ["o-1"],
      actorRef: "staff-1",
    });
    expect(result.ok).toBe(true);
    expect((await linesOf("o-1"))[0]?.authorName).toBeNull();
  });
});
