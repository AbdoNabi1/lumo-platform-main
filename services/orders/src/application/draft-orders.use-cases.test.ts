import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { DomainError } from "@platform/utils";
import type { DraftOrderContent } from "../domain/draft-order";
import { Order } from "../domain/order";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { InMemoryDraftNumberAllocator } from "../infrastructure/in-memory-draft-number-allocator";
import { InMemoryDraftOrderRepository } from "../infrastructure/in-memory-draft-order-repository";
import { InMemoryOrderAnnotationRepository } from "../infrastructure/in-memory-order-annotation-repository";
import { InMemoryOrderRepository } from "../infrastructure/in-memory-order-repository";
import { InMemoryOrderTimelineRepository } from "../infrastructure/in-memory-order-timeline-repository";
import { InMemoryStaffDirectory } from "../infrastructure/in-memory-port-adapters";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { OrderEventTranslator } from "../infrastructure/order-event-translator";
import {
  CompleteDraftFromCheckout,
  CreateDraftOrder,
  DeleteDraftOrder,
  GetDraftOrder,
  ListDraftOrders,
  MarkDraftInvoiceSent,
  SetDraftCheckout,
  UpdateDraftOrder,
} from "./draft-orders.use-cases";

const T = "tenant-a";
const NOW = new Date("2026-10-25T10:00:00.000Z");
const ORDER_ID = "55555555-5555-7555-8555-555555555555";
const CONTENT: DraftOrderContent = {
  customerRef: null,
  contactEmail: "sara@example.com",
  contactPhone: null,
  shippingAddress: {
    name: "Sara",
    phone: "01001234567",
    line1: "1 Nile St",
    line2: null,
    city: "Cairo",
    province: "EG-C",
    postalCode: "",
    country: "EG",
  },
  billingAddress: null,
  lines: [
    {
      productRef: "p-1",
      variantRef: "v-1",
      sku: "TEE",
      title: "Tee",
      variantTitle: null,
      quantity: 2,
      unitPriceMinor: 25000,
    },
  ],
  discount: { valueType: "fixed", value: 5000, reason: "Loyal customer" },
  shipping: { kind: "custom", title: "Courier", amountMinor: 4000 },
  note: "Deliver after 5 pm",
  tags: ["WhatsApp", "vip"],
};

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

async function world(drafts: InMemoryDraftOrderRepository = new InMemoryDraftOrderRepository()) {
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
  await orders.save(
    Order.place(
      UniqueEntityId.from(ORDER_ID),
      must(OrderNumber.create("1001")),
      "customer-1",
      "EGP",
      [
        OrderItem.create(
          UniqueEntityId.from("item-1"),
          must(ProductSnapshot.create("p-1", "Tee", must(Money.create(25000, "EGP")))),
          2,
        ),
      ],
      must(AddressSnapshot.create("1 Nile St", "Cairo", "", "EG")),
      "evt-1",
      new Date(0),
    ),
    T,
  );
  const annotations = new InMemoryOrderAnnotationRepository({ orders });
  const timeline = new InMemoryOrderTimelineRepository();
  let n = 0;
  const deps = {
    drafts,
    draftNumbers: new InMemoryDraftNumberAllocator(),
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: {
      generate: () => `33333333-3333-7333-8333-${(n += 1).toString().padStart(12, "0")}`,
    },
    clock: { now: () => NOW },
    annotations,
    activity: {
      timeline,
      staff: new InMemoryStaffDirectory({ "staff-1": "Ahmed" }),
      idGenerator: {
        generate: () => `66666666-6666-7666-8666-${(n += 1).toString().padStart(12, "0")}`,
      },
    },
  };
  return {
    drafts,
    annotations,
    timeline,
    create: new CreateDraftOrder(deps),
    update: new UpdateDraftOrder(deps),
    remove: new DeleteDraftOrder(deps),
    get: new GetDraftOrder(deps),
    list: new ListDraftOrders(deps),
    invoiceSent: new MarkDraftInvoiceSent(deps),
    setCheckout: new SetDraftCheckout(deps),
    complete: new CompleteDraftFromCheckout(deps),
  };
}

/** A repository whose guarded writes can lose a race: the other writer wins, then ours answers false. */
class RacyDraftRepository extends InMemoryDraftOrderRepository {
  loseCompletion: ((id: string, tenantId: string) => Promise<void>) | undefined;
  loseDelete: ((id: string, tenantId: string) => Promise<void>) | undefined;
  beforeContentSave: ((id: string, tenantId: string) => Promise<void>) | undefined;
  readonly hidden = new Set<string>();
  readonly realMarkCompleted = (
    ...args: Parameters<InMemoryDraftOrderRepository["markCompleted"]>
  ) => super.markCompleted(...args);
  readonly realSoftDelete = (...args: Parameters<InMemoryDraftOrderRepository["softDelete"]>) =>
    super.softDelete(...args);

  override async findById(...args: Parameters<InMemoryDraftOrderRepository["findById"]>) {
    return this.hidden.has(args[0]) ? null : super.findById(...args);
  }

  override async markCompleted(
    ...args: Parameters<InMemoryDraftOrderRepository["markCompleted"]>
  ): Promise<boolean> {
    if (this.loseCompletion === undefined) return super.markCompleted(...args);
    await this.loseCompletion(args[0], args[2]);
    return false;
  }

  override async softDelete(
    ...args: Parameters<InMemoryDraftOrderRepository["softDelete"]>
  ): Promise<boolean> {
    if (this.loseDelete === undefined) return super.softDelete(...args);
    await this.loseDelete(args[0], args[2]);
    return false;
  }

  override async save(...args: Parameters<InMemoryDraftOrderRepository["save"]>): Promise<void> {
    if (!args[0].isNew) await this.beforeContentSave?.(args[0].id, args[1]);
    return super.save(...args);
  }
}

const value = <T>(r: { ok: true; value: T } | { ok: false; error: DomainError }): T => {
  if (!r.ok) throw r.error;
  return r.value;
};
const failure = <T>(r: { ok: true; value: T } | { ok: false; error: DomainError }): DomainError => {
  if (r.ok) throw new Error("expected a failure");
  return r.error;
};

describe("CreateDraftOrder", () => {
  it("numbers drafts D1, D2 per shop and stores the normalized content", async () => {
    const w = await world();
    const first = value(
      await w.create.execute({
        tenantId: T,
        createdBy: "staff-1",
        currency: "EGP",
        content: CONTENT,
      }),
    );
    const second = value(
      await w.create.execute({
        tenantId: T,
        createdBy: "staff-1",
        currency: "EGP",
        content: CONTENT,
      }),
    );
    expect(first.draft.draftNumber).toBe("D1");
    expect(second.draft.draftNumber).toBe("D2");
    expect(first.draft.status).toBe("open");
    expect(value(await w.get.execute({ tenantId: T, draftId: first.draft.id })).tags).toEqual([
      "WhatsApp",
      "vip",
    ]);
  });

  it("refuses invalid content without burning a number", async () => {
    const w = await world();
    const refused = failure(
      await w.create.execute({
        tenantId: T,
        createdBy: "s",
        currency: "EGP",
        content: { ...CONTENT, lines: [] },
      }),
    );
    expect(refused.code).toBe("VALIDATION");
    const ok = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    expect(ok.draft.draftNumber).toBe("D1");
  });
});

describe("UpdateDraftOrder", () => {
  it("bumps the version; a stale version answers VERSION_CONFLICT", async () => {
    const w = await world();
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    const updated = value(
      await w.update.execute({
        tenantId: T,
        draftId: draft.id,
        version: 0,
        content: { ...CONTENT, note: "x" },
      }),
    );
    expect(updated.draft.version).toBe(1);
    expect(updated.draft.note).toBe("x");
    const stale = failure(
      await w.update.execute({ tenantId: T, draftId: draft.id, version: 0, content: CONTENT }),
    );
    expect(stale.code).toBe("CONCURRENCY");
    expect(stale.message).toMatch(/^VERSION_CONFLICT:/);
  });

  it("refuses a completed draft and answers 404 for a deleted one", async () => {
    const w = await world();
    const a = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    ).draft;
    const b = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    ).draft;
    value(await w.complete.execute({ tenantId: T, draftId: a.id, orderRef: ORDER_ID }));
    expect(
      failure(await w.update.execute({ tenantId: T, draftId: a.id, version: 0, content: CONTENT }))
        .message,
    ).toMatch(/^DRAFT_COMPLETED:/);
    value(await w.remove.execute({ tenantId: T, draftId: b.id }));
    expect(
      failure(await w.update.execute({ tenantId: T, draftId: b.id, version: 0, content: CONTENT }))
        .code,
    ).toBe("NOT_FOUND");
  });
});

describe("DeleteDraftOrder / GetDraftOrder / ListDraftOrders", () => {
  it("soft-deletes: get answers 404, the list hides it, a completed draft cannot be deleted", async () => {
    const w = await world();
    const a = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    ).draft;
    const b = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    ).draft;
    value(await w.remove.execute({ tenantId: T, draftId: a.id }));
    expect(failure(await w.get.execute({ tenantId: T, draftId: a.id })).code).toBe("NOT_FOUND");
    expect((await w.drafts.findById(a.id, T))?.deletedAt).toEqual(NOW);
    expect(value(await w.list.execute({ tenantId: T })).items.map((d) => d.draftNumber)).toEqual([
      "D2",
    ]);
    value(await w.complete.execute({ tenantId: T, draftId: b.id, orderRef: ORDER_ID }));
    expect(failure(await w.remove.execute({ tenantId: T, draftId: b.id })).message).toMatch(
      /^DRAFT_COMPLETED:/,
    );
  });

  it("lists by status and by a # search", async () => {
    const w = await world();
    const a = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    ).draft;
    value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    value(await w.invoiceSent.execute({ tenantId: T, draftId: a.id }));
    expect(
      value(await w.list.execute({ tenantId: T, status: "invoice_sent" })).items.map(
        (d) => d.draftNumber,
      ),
    ).toEqual(["D1"]);
    expect(
      value(await w.list.execute({ tenantId: T, search: "#d2" })).items.map((d) => d.draftNumber),
    ).toEqual(["D2"]);
  });
});

describe("MarkDraftInvoiceSent / SetDraftCheckout", () => {
  it("marks invoice sent without changing the version; CAS on the checkout", async () => {
    const w = await world();
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    const sent = value(await w.invoiceSent.execute({ tenantId: T, draftId: draft.id })).draft;
    expect(sent.status).toBe("invoice_sent");
    expect(sent.invoiceSentAt).toEqual(NOW);
    expect(sent.version).toBe(0);
    const input = {
      tenantId: T,
      draftId: draft.id,
      checkoutRef: "s-1",
      checkoutVersion: 0,
      expectedCheckoutRef: null,
    };
    expect(value(await w.setCheckout.execute(input))).toEqual({ applied: true });
    expect(value(await w.setCheckout.execute({ ...input, checkoutRef: "s-2" }))).toEqual({
      applied: false,
    });
  });
});

describe("CompleteDraftFromCheckout", () => {
  it("completes, copies note and tags onto the order and writes created_from_draft with the actor", async () => {
    const w = await world();
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    const done = value(
      await w.complete.execute({
        tenantId: T,
        draftId: draft.id,
        orderRef: ORDER_ID,
        actorRef: "staff-1",
      }),
    );
    expect(done).toEqual({ draftId: draft.id, orderRef: ORDER_ID, changed: true });
    const stored = await w.drafts.findById(draft.id, T);
    expect(stored?.status).toBe("completed");
    expect(stored?.orderRef).toBe(ORDER_ID);
    const annotations = (await w.annotations.annotationsOf([ORDER_ID], T)).get(ORDER_ID);
    expect(annotations?.note).toBe("Deliver after 5 pm");
    expect(annotations?.tags).toEqual(["vip", "WhatsApp"]);
    const lines = await w.timeline.listForOrder(ORDER_ID, T, { first: 200 });
    expect(lines.map((l) => [l.kind, l.authorName, l.data])).toEqual([
      ["created_from_draft", "Ahmed", { draftNumber: "D1", draftId: draft.id }],
    ]);
  });

  it("is idempotent for the same order and refuses another order", async () => {
    const w = await world();
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    value(await w.complete.execute({ tenantId: T, draftId: draft.id, orderRef: ORDER_ID }));
    expect(
      value(await w.complete.execute({ tenantId: T, draftId: draft.id, orderRef: ORDER_ID }))
        .changed,
    ).toBe(false);
    expect(
      failure(await w.complete.execute({ tenantId: T, draftId: draft.id, orderRef: "other" }))
        .message,
    ).toMatch(/^DRAFT_COMPLETED:/);
    expect(await w.timeline.listForOrder(ORDER_ID, T, { first: 200 })).toHaveLength(1);
  });

  it("a shopper's payment writes a system line (no author)", async () => {
    const w = await world();
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    value(await w.complete.execute({ tenantId: T, draftId: draft.id, orderRef: ORDER_ID }));
    const [line] = await w.timeline.listForOrder(ORDER_ID, T, { first: 200 });
    expect(line?.authorRef).toBeNull();
    expect(line?.authorName).toBeNull();
  });

  it("completes a deleted draft whose checkout became an order (Ruling 17)", async () => {
    const w = await world();
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    value(await w.remove.execute({ tenantId: T, draftId: draft.id }));
    expect(
      value(await w.complete.execute({ tenantId: T, draftId: draft.id, orderRef: ORDER_ID }))
        .changed,
    ).toBe(true);
    expect(value(await w.get.execute({ tenantId: T, draftId: draft.id })).status).toBe("completed");
  });

  it("an unknown draft is NOT_FOUND; another shop's draft is unknown", async () => {
    const w = await world();
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    expect(
      failure(
        await w.complete.execute({ tenantId: "tenant-b", draftId: draft.id, orderRef: ORDER_ID }),
      ).code,
    ).toBe("NOT_FOUND");
  });
});

describe("lost races (guarded writes that answer false)", () => {
  const OTHER_ORDER = "77777777-7777-7777-8777-777777777777";
  const make = async () => {
    const repo = new RacyDraftRepository();
    const w = await world(repo);
    const { draft } = value(
      await w.create.execute({ tenantId: T, createdBy: "s", currency: "EGP", content: CONTENT }),
    );
    return { repo, w, draft };
  };

  it("completion: a draft another order completed meanwhile answers DRAFT_COMPLETED", async () => {
    const { repo, w, draft } = await make();
    repo.loseCompletion = async (id, tenantId) => {
      await repo.realMarkCompleted(id, { orderRef: OTHER_ORDER, at: NOW }, tenantId);
    };
    const refused = failure(
      await w.complete.execute({ tenantId: T, draftId: draft.id, orderRef: ORDER_ID }),
    );
    expect(refused.message).toMatch(/^DRAFT_COMPLETED:/);
    expect((await repo.findById(draft.id, T))?.orderRef).toBe(OTHER_ORDER);
    expect(await w.timeline.listForOrder(ORDER_ID, T, { first: 200 })).toHaveLength(0);
  });

  it("completion: the same order completing it meanwhile is an idempotent repeat", async () => {
    const { repo, w, draft } = await make();
    repo.loseCompletion = async (id, tenantId) => {
      await repo.realMarkCompleted(id, { orderRef: ORDER_ID, at: NOW }, tenantId);
    };
    expect(
      value(await w.complete.execute({ tenantId: T, draftId: draft.id, orderRef: ORDER_ID })),
    ).toEqual({ draftId: draft.id, orderRef: ORDER_ID, changed: false });
  });

  it("completion: a draft that vanished meanwhile answers NOT_FOUND", async () => {
    const { repo, w, draft } = await make();
    repo.loseCompletion = async (id) => {
      repo.hidden.add(id);
    };
    expect(
      failure(await w.complete.execute({ tenantId: T, draftId: draft.id, orderRef: ORDER_ID }))
        .code,
    ).toBe("NOT_FOUND");
  });

  it("delete: a draft deleted meanwhile answers 404, a completed one DRAFT_COMPLETED", async () => {
    const { repo, w, draft } = await make();
    repo.loseDelete = async (id, tenantId) => {
      await repo.realSoftDelete(id, NOW, tenantId);
    };
    expect(failure(await w.remove.execute({ tenantId: T, draftId: draft.id })).code).toBe(
      "NOT_FOUND",
    );
    const second = await make();
    second.repo.loseDelete = async (id, tenantId) => {
      await second.repo.realMarkCompleted(id, { orderRef: ORDER_ID, at: NOW }, tenantId);
    };
    expect(
      failure(await second.w.remove.execute({ tenantId: T, draftId: second.draft.id })).message,
    ).toMatch(/^DRAFT_COMPLETED:/);
  });

  it("update: a completion between the version check and the save answers VERSION_CONFLICT", async () => {
    const { repo, w, draft } = await make();
    repo.beforeContentSave = async (id, tenantId) => {
      await repo.realMarkCompleted(id, { orderRef: ORDER_ID, at: NOW }, tenantId);
    };
    const refused = failure(
      await w.update.execute({ tenantId: T, draftId: draft.id, version: 0, content: CONTENT }),
    );
    expect(refused.code).toBe("CONCURRENCY");
    expect(refused.message).toMatch(/^VERSION_CONFLICT:/);
  });
});

describe("CompleteDraftFromCheckout verifies the order first", () => {
  it("another shop's order is NOT_FOUND and leaves the draft open", async () => {
    const repo = new InMemoryDraftOrderRepository();
    const w = await world(repo);
    const { draft } = value(
      await w.create.execute({
        tenantId: "tenant-b",
        createdBy: "s",
        currency: "EGP",
        content: CONTENT,
      }),
    );
    const refused = failure(
      await w.complete.execute({ tenantId: "tenant-b", draftId: draft.id, orderRef: ORDER_ID }),
    );
    expect(refused.code).toBe("NOT_FOUND");
    expect((await repo.findById(draft.id, "tenant-b"))?.status).toBe("open");
    expect(await w.timeline.listForOrder(ORDER_ID, "tenant-b", { first: 200 })).toHaveLength(0);
  });
});
