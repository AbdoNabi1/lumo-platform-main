import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import {
  assertWriteTimeTenant,
  tenantRowIsolationCases,
  type TenantRowStore,
} from "@platform/messaging/testing";
import { ConcurrencyError } from "@platform/utils";
import { Order } from "../domain/order";
import { DraftOrder } from "../domain/draft-order";
import type { DraftOrderRepository } from "../domain/draft-order-repository";
import { OrderItem } from "../domain/order-item";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";
import { createFakePrisma } from "@platform/db/testing";
import type { OrderAnnotationRepository } from "../domain/order-annotations";
import type { OrderTimelineEntry, OrderTimelineRepository } from "../domain/order-timeline";
import { InMemoryDraftOrderRepository } from "./in-memory-draft-order-repository";
import { InMemoryOrderAnnotationRepository } from "./in-memory-order-annotation-repository";
import { InMemoryOrderRepository } from "./in-memory-order-repository";
import { InMemoryOrderTimelineRepository } from "./in-memory-order-timeline-repository";
import { InMemoryInventoryAdapter, InMemoryShippingAdapter } from "./in-memory-port-adapters";
import { OrderEventTranslator } from "./order-event-translator";
import { PrismaDraftOrderRepository } from "./prisma-draft-order-repository";
import { PrismaOrderAnnotationRepository } from "./prisma-order-annotation-repository";
import { PrismaOrderTimelineRepository } from "./prisma-order-timeline-repository";

/** ADR-0014 (WP-10, T10.3): one Orders repository / port stub serves every tenant. */
function unwrap<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("test setup: invalid VO");
  return result.value;
}

function placeOrder(id: string, customerRef = "customer-1"): Order {
  const snapshot = unwrap(
    ProductSnapshot.create("product-1", "Toy", unwrap(Money.create(500, "USD"))),
  );
  return Order.place(
    UniqueEntityId.from(id),
    unwrap(OrderNumber.create("ORD-1")),
    customerRef,
    "USD",
    [OrderItem.create(UniqueEntityId.from("item-1"), snapshot, 1)],
    unwrap(AddressSnapshot.create("1 Main St", "Town", "12345", "US")),
    "evt-1",
    new Date(0),
  );
}

function repository(outbox?: OutboxWriter) {
  const writer =
    outbox ??
    new OutboxWriter({
      store: new InMemoryOutboxStore(),
      translator: new OrderEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock: { now: () => new Date(0) },
      producer: "orders",
    });
  return new InMemoryOrderRepository({
    outbox: writer,
    context: rootEventContext({ generate: () => "evt-x" }),
  });
}

describe("orders tenant isolation (ADR-0014)", () => {
  it("the offline reservation/shipment stubs dedupe per (tenant, order), not per order alone", async () => {
    const inventory = new InMemoryInventoryAdapter();
    const shipping = new InMemoryShippingAdapter();

    const a = await inventory.requestReservation("order-1", "tenant-a");
    const b = await inventory.requestReservation("order-1", "tenant-b");
    const aAgain = await inventory.requestReservation("order-1", "tenant-a");
    const sa = await shipping.requestShipment("order-1", "tenant-a");
    const sb = await shipping.requestShipment("order-1", "tenant-b");

    expect(b.reservationRef).not.toBe(a.reservationRef);
    expect(aAgain).toEqual(a);
    expect(sb.shipmentRef).not.toBe(sa.shipmentRef);
  });

  it("merges the per-call tenantId into the outbox event context at write time", async () => {
    await assertWriteTimeTenant("orders", async (outbox, tenantId) => {
      await repository(outbox).save(placeOrder("order-1"), tenantId);
    });
  });
});

// ── T10.5 row isolation (shared harness) ─────────────────────────────────────────────────────────
// Orders: money and PII. In-memory adapter ONLY — the Prisma repository reads through `include`
// (items/events relations) which the fake-prisma does not model, so its tenant scoping is covered
// solely by the DATABASE_URL_TEST-gated integration suite (which does not run in CI here). That is
// a stated coverage limit of this case, recorded in the gap register.
function orderStore(): TenantRowStore {
  const repo = repository();
  return {
    insert: (tenantId, key, marker) => repo.save(placeOrder(key, marker), tenantId),
    find: async (tenantId, key) => (await repo.findById(key, tenantId))?.customerRef ?? null,
    list: async (tenantId) =>
      (await repo.list({ first: 100 }, tenantId)).items.map((order) => order.customerRef),
    // The attacker addresses the victim's order id under its own tenant.
    update: (tenantId, key, marker) => repo.save(placeOrder(key, marker), tenantId),
  };
}

describe("orders tenant isolation via the shared harness (T10.5)", () => {
  for (const c of tenantRowIsolationCases({
    context: "orders/order",
    layer: "in-memory adapter (Prisma: integration suite only)",
    make: orderStore,
  }))
    it(c.name, c.run);
});

// ── order operations Part 1: the archive timestamp ──────────────────────────────────────────────
// `setArchived`/`annotationsOf` are plain `where` reads/writes, so the Prisma adapter runs over the
// fake that applies `where` literally: it cannot pass because of RLS.
const VICTIM = "01900000-0000-7000-8000-00000000000a";

async function annotationLayers(): Promise<
  readonly [string, OrderAnnotationRepository, unknown][]
> {
  const fake = createFakePrisma();
  // fake-prisma has no column defaults: seed archivedAt explicitly, as the column's NULL.
  await fake.database.order.create({
    data: { id: VICTIM, tenantId: "tenant-b", archivedAt: null } as never,
  });
  const memoryOrders = repository();
  await memoryOrders.save(placeOrder(VICTIM), "tenant-b");
  return [
    [
      "prisma over fake-prisma",
      new PrismaOrderAnnotationRepository({ prisma: fake.database }),
      fake.database,
    ],
    ["in-memory", new InMemoryOrderAnnotationRepository({ orders: memoryOrders }), undefined],
  ];
}

describe("order annotations tenant isolation (order operations Part 1)", () => {
  it("tenant A can neither archive nor read tenant B's order; B can archive its own", async () => {
    for (const [layer, annotations, tx] of await annotationLayers()) {
      expect(await annotations.setArchived([VICTIM], new Date(1), "tenant-a", tx), layer).toEqual(
        [],
      );
      expect((await annotations.annotationsOf([VICTIM], "tenant-a", tx)).size, layer).toBe(0);
      expect(
        (await annotations.annotationsOf([VICTIM], "tenant-b", tx)).get(VICTIM),
        layer,
      ).toEqual({ archivedAt: null, note: null, tags: [] });
      expect(await annotations.setArchived([VICTIM], new Date(1), "tenant-b", tx), layer).toEqual([
        VICTIM,
      ]);
    }
  });
});

// ── order operations Part 2: note, tags and the timeline ────────────────────────────────────────
describe("order note and tags tenant isolation (order operations Part 2)", () => {
  it("tenant A can neither write nor read tenant B's note or tags; B can", async () => {
    for (const [layer, annotations, tx] of await annotationLayers()) {
      expect(await annotations.setNote(VICTIM, "mine now", "tenant-a", tx), layer).toBe(false);
      expect(
        (await annotations.addTags([VICTIM], [{ tag: "vip", tagKey: "vip" }], "tenant-a", tx)).size,
        layer,
      ).toBe(0);
      expect(await annotations.setNote(VICTIM, "Ring twice", "tenant-b", tx), layer).toBe(true);
      expect(
        [...(await annotations.addTags([VICTIM], [{ tag: "VIP", tagKey: "vip" }], "tenant-b", tx))],
        layer,
      ).toEqual([[VICTIM, ["VIP"]]]);
      expect((await annotations.removeTags([VICTIM], ["vip"], "tenant-a", tx)).size, layer).toBe(0);
      expect((await annotations.annotationsOf([VICTIM], "tenant-a", tx)).size, layer).toBe(0);
      expect(
        (await annotations.annotationsOf([VICTIM], "tenant-b", tx)).get(VICTIM),
        layer,
      ).toEqual({
        archivedAt: null,
        note: "Ring twice",
        tags: ["VIP"],
      });
    }
  });

  it("tenant A's suggestions never include tenant B's tags (in-memory; Prisma: the raw SQL filters tenant_id)", async () => {
    const memoryOrders = repository();
    await memoryOrders.save(placeOrder(VICTIM), "tenant-b");
    const annotations = new InMemoryOrderAnnotationRepository({ orders: memoryOrders });
    await annotations.addTags([VICTIM], [{ tag: "VIP", tagKey: "vip" }], "tenant-b");
    expect(await annotations.tagsInUse("tenant-a")).toEqual([]);
    expect(await annotations.tagsInUse("tenant-b")).toEqual([{ tag: "VIP", count: 1 }]);
  });
});

const COMMENT_ID = "01900000-0000-7000-8000-0000000000c1";
const victimComment = (): OrderTimelineEntry => ({
  id: COMMENT_ID,
  orderId: VICTIM,
  kind: "comment",
  authorRef: "staff-b",
  authorName: "B",
  body: "Call before delivery",
  data: {},
  createdAt: new Date(1),
  editedAt: null,
  deletedAt: null,
});

function timelineLayers(): readonly [string, OrderTimelineRepository, unknown][] {
  const fake = createFakePrisma();
  return [
    [
      "prisma over fake-prisma",
      new PrismaOrderTimelineRepository({ prisma: fake.database }),
      fake.database,
    ],
    ["in-memory", new InMemoryOrderTimelineRepository(), undefined],
  ];
}

describe("order timeline tenant isolation (order operations Part 2)", () => {
  it("tenant A can neither read nor edit tenant B's timeline", async () => {
    for (const [layer, timeline, tx] of timelineLayers()) {
      await timeline.append(victimComment(), "tenant-b", tx);
      expect(await timeline.listForOrder(VICTIM, "tenant-a", { first: 200 }, tx), layer).toEqual(
        [],
      );
      expect(await timeline.findById(COMMENT_ID, "tenant-a", tx), layer).toBeNull();
      await timeline.update(
        { ...victimComment(), body: "hijacked", editedAt: new Date(2) },
        "tenant-a",
        tx,
      );
      expect((await timeline.findById(COMMENT_ID, "tenant-b", tx))?.body, layer).toBe(
        "Call before delivery",
      );
    }
  });
});

describe("draft orders tenant isolation (order operations Part 4)", () => {
  const VICTIM_DRAFT = "44444444-4444-7444-8444-444444444444";
  const content = {
    customerRef: null,
    contactEmail: "victim@example.com",
    contactPhone: null,
    shippingAddress: null,
    billingAddress: null,
    lines: [
      {
        productRef: "p",
        variantRef: "v",
        sku: "S",
        title: "T",
        variantTitle: null,
        quantity: 1,
        unitPriceMinor: 100,
      },
    ],
    discount: null,
    shipping: null,
    note: null,
    tags: [],
  };
  function draftLayers(): readonly [string, DraftOrderRepository, unknown][] {
    const fake = createFakePrisma();
    return [
      ["in-memory", new InMemoryDraftOrderRepository(), {}],
      [
        "prisma over fake-prisma",
        new PrismaDraftOrderRepository({ prisma: fake.database }),
        fake.database,
      ],
    ];
  }

  it.each(draftLayers())(
    "%s: another shop can neither read nor move a draft",
    async (_n, repo, tx) => {
      const created = DraftOrder.create({
        id: VICTIM_DRAFT,
        draftNumber: "D1",
        currency: "EGP",
        createdBy: "s",
        now: new Date(0),
        content,
      });
      if (!created.ok) throw created.error;
      await repo.save(created.value, "victim", tx);
      const at = new Date(0);
      expect(await repo.findById(VICTIM_DRAFT, "attacker")).toBeNull();
      // fake-prisma has no `$queryRaw`, so the Prisma list's tenant filter (in the SQL itself) is
      // pinned by the gated integration test instead.
      if (repo instanceof InMemoryDraftOrderRepository) {
        expect((await repo.list({}, "attacker")).items).toEqual([]);
      }
      expect(await repo.markInvoiceSent(VICTIM_DRAFT, at, "attacker", tx)).toBe(false);
      expect(await repo.markCompleted(VICTIM_DRAFT, { orderRef: "o", at }, "attacker", tx)).toBe(
        false,
      );
      expect(await repo.softDelete(VICTIM_DRAFT, at, "attacker", tx)).toBe(false);
      expect(
        await repo.setCheckout(
          VICTIM_DRAFT,
          { checkoutRef: "s", checkoutVersion: 0 },
          null,
          "attacker",
          tx,
        ),
      ).toBe(false);
      // A content save through the attacker's tenant must not land on the victim's row either.
      const hijack = await repo.findById(VICTIM_DRAFT, "victim");
      hijack?.revise({ ...content, note: "hijacked" }, at);
      await expect(repo.save(hijack as DraftOrder, "attacker", tx)).rejects.toBeInstanceOf(
        ConcurrencyError,
      );
      const victim = await repo.findById(VICTIM_DRAFT, "victim");
      expect(victim?.note).toBeNull();
      expect(victim?.version).toBe(0);
      expect(victim?.status).toBe("open");
      expect(victim?.checkoutRef).toBeNull();
      expect(victim?.deletedAt).toBeNull();
    },
  );
});
