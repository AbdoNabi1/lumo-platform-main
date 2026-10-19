import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { MAX_COMMENT_LENGTH } from "../domain/order-timeline";
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
  AddOrderComment,
  DeleteOrderComment,
  EditOrderComment,
  ListOrderTimeline,
} from "./order-timeline.use-cases";

const TENANT = "tenant-a";
const T0 = new Date("2026-10-19T09:00:00.000Z");
const T1 = new Date("2026-10-19T10:00:00.000Z");

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

async function wire() {
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
  for (const id of ["o-1", "o-2"]) await orders.save(placed(id), TENANT);
  await orders.save(placed("theirs"), "tenant-b");
  const timeline = new InMemoryOrderTimelineRepository();
  const staff = new InMemoryStaffDirectory({ "staff-1": "Ahmed", "staff-2": "Mona" });
  let now = T0;
  let n = 0;
  const deps = {
    annotations: new InMemoryOrderAnnotationRepository({ orders }),
    timeline,
    staff,
    idGenerator: { generate: () => `entry-${(n += 1)}` },
    clock: { now: () => now },
    unitOfWork: new InMemoryUnitOfWork(),
  };
  return {
    timeline,
    staff,
    add: new AddOrderComment(deps),
    edit: new EditOrderComment(deps),
    remove: new DeleteOrderComment(deps),
    list: new ListOrderTimeline({ timeline }),
    later: () => {
      now = T1;
    },
  };
}

const comment = (body: string, actorRef = "staff-1", orderId = "o-1") => ({
  tenantId: TENANT,
  orderId,
  body,
  actorRef,
});

describe("AddOrderComment (order operations Part 2)", () => {
  it("stores the trimmed comment with the author's name snapshot and the time", async () => {
    const { add } = await wire();
    const result = await add.execute(comment("  Called — no answer  "));
    expect(result).toEqual({
      ok: true,
      value: {
        id: "entry-1",
        orderId: "o-1",
        kind: "comment",
        authorRef: "staff-1",
        authorName: "Ahmed",
        body: "Called — no answer",
        data: {},
        createdAt: T0,
        editedAt: null,
        deletedAt: null,
      },
    });
  });

  it("refuses an empty or a 5,001-character comment, and an unknown order", async () => {
    const { add, timeline } = await wire();
    for (const body of ["   ", "a".repeat(MAX_COMMENT_LENGTH + 1)]) {
      const result = await add.execute(comment(body));
      expect(!result.ok && result.error.code).toBe("VALIDATION");
    }
    const unknown = await add.execute(comment("hi", "staff-1", "missing"));
    expect(!unknown.ok && unknown.error.code).toBe("NOT_FOUND");
    expect(await timeline.listForOrder("o-1", TENANT, { first: 200 })).toEqual([]);
    expect(await timeline.listForOrder("missing", TENANT, { first: 200 })).toEqual([]);
  });

  it("refuses another shop's order (NOT_FOUND) and writes nothing in either shop (carried 2)", async () => {
    const { add, timeline } = await wire();
    const result = await add.execute(comment("hi", "staff-1", "theirs"));
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
    expect(await timeline.listForOrder("theirs", TENANT, { first: 200 })).toEqual([]);
    expect(await timeline.listForOrder("theirs", "tenant-b", { first: 200 })).toEqual([]);
  });
});

describe("EditOrderComment", () => {
  it("lets the author edit: new body and an edited time", async () => {
    const { add, edit, later } = await wire();
    await add.execute(comment("first"));
    later();
    const result = await edit.execute({ ...comment("second"), entryId: "entry-1" });
    expect(result.ok && result.value).toMatchObject({
      body: "second",
      editedAt: T1,
      createdAt: T0,
    });
  });

  it("refuses anyone but the author (FORBIDDEN), even an admin", async () => {
    const { add, edit } = await wire();
    await add.execute(comment("first"));
    const result = await edit.execute({ ...comment("hijack", "staff-2"), entryId: "entry-1" });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN");
  });

  it("an entry of another order is not found, and the other order's comment is untouched (Review Focus 5)", async () => {
    const { add, edit, timeline } = await wire();
    await add.execute(comment("on o-2", "staff-1", "o-2"));
    const result = await edit.execute({ ...comment("moved"), entryId: "entry-1" });
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
    expect((await timeline.findById("entry-1", TENANT))?.body).toBe("on o-2");
  });

  it("a deleted comment cannot be edited (CONFLICT) (Review Focus 4)", async () => {
    const { add, edit, remove } = await wire();
    await add.execute(comment("first"));
    await remove.execute({
      tenantId: TENANT,
      orderId: "o-1",
      entryId: "entry-1",
      actorRef: "staff-1",
      canModerate: false,
    });
    const result = await edit.execute({ ...comment("again"), entryId: "entry-1" });
    expect(!result.ok && result.error.code).toBe("CONFLICT");
  });

  it("an activity line is never editable (BUSINESS_RULE)", async () => {
    const { edit, timeline } = await wire();
    await timeline.append(
      {
        id: "activity-1",
        orderId: "o-1",
        kind: "archived",
        authorRef: "staff-1",
        authorName: "Ahmed",
        body: null,
        data: {},
        createdAt: T0,
        editedAt: null,
        deletedAt: null,
      },
      TENANT,
    );
    const result = await edit.execute({ ...comment("x"), entryId: "activity-1" });
    expect(!result.ok && result.error.code).toBe("BUSINESS_RULE");
  });
});

describe("DeleteOrderComment", () => {
  const del = (entryId: string, actorRef: string, canModerate = false) => ({
    tenantId: TENANT,
    orderId: "o-1",
    entryId,
    actorRef,
    canModerate,
  });

  it("the author soft-deletes: the row stays (with its text) and reads as deleted", async () => {
    const { add, remove, timeline, later } = await wire();
    await add.execute(comment("secret"));
    later();
    const result = await remove.execute(del("entry-1", "staff-1"));
    expect(result.ok && result.value.deletedAt).toEqual(T1);
    expect(await timeline.findById("entry-1", TENANT)).toMatchObject({
      body: "secret",
      deletedAt: T1,
    });
  });

  it("a moderator (admin) deletes anyone's comment; anyone else is FORBIDDEN", async () => {
    const { add, remove } = await wire();
    await add.execute(comment("by Ahmed"));
    const refused = await remove.execute(del("entry-1", "staff-2"));
    expect(!refused.ok && refused.error.code).toBe("FORBIDDEN");
    const moderated = await remove.execute(del("entry-1", "staff-2", true));
    expect(moderated.ok).toBe(true);
  });

  it("deleting an already-deleted comment is a no-op that keeps the first time (Review Focus 4)", async () => {
    const { add, remove, later } = await wire();
    await add.execute(comment("x"));
    await remove.execute(del("entry-1", "staff-1"));
    later();
    const again = await remove.execute(del("entry-1", "staff-1"));
    expect(again.ok && again.value.deletedAt).toEqual(T0);
  });

  it("an entry of another order is not found (Review Focus 5)", async () => {
    const { add, remove } = await wire();
    await add.execute(comment("on o-2", "staff-1", "o-2"));
    const result = await remove.execute(del("entry-1", "staff-1", true));
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
  });
});

describe("ListOrderTimeline", () => {
  it("answers the order's latest 200 lines, newest first", async () => {
    const { add, list } = await wire();
    for (let i = 0; i < 201; i += 1) await add.execute(comment(`c${i}`));
    const result = await list.execute({ tenantId: TENANT, orderId: "o-1" });
    expect(result.ok && result.value).toHaveLength(200);
  });

  it("keeps the author name as written when the staff member is renamed later", async () => {
    const { add, list, staff } = await wire();
    await add.execute(comment("hello"));
    staff.setName("staff-1", "Ahmed M.");
    const result = await list.execute({ tenantId: TENANT, orderId: "o-1" });
    expect(result.ok && result.value[0]?.authorName).toBe("Ahmed");
  });
});
