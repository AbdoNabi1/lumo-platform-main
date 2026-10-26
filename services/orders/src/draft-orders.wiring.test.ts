import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireOrders } from "./composition";
import type { DraftOrderContent } from "./domain/draft-order";

const CONTENT: DraftOrderContent = {
  customerRef: null,
  contactEmail: "sara@example.com",
  contactPhone: null,
  shippingAddress: {
    name: "Sara",
    phone: null,
    line1: "1 Nile St",
    line2: null,
    city: "Cairo",
    province: null,
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
      quantity: 1,
      unitPriceMinor: 25000,
    },
  ],
  discount: null,
  shipping: { kind: "free", title: "Free shipping", amountMinor: 0 },
  note: null,
  tags: [],
};

function wired() {
  let n = 0;
  return wireOrders({
    serializer: new InMemoryEventSerializer(),
    idGenerator: {
      generate: () => `00000000-0000-7000-8000-${(n += 1).toString().padStart(12, "0")}`,
    },
    clock: { now: () => new Date("2026-10-25T10:00:00.000Z") },
  }).orders;
}

describe("wireOrders — draft orders (order operations Part 4)", () => {
  it("creates, reads, lists and version-checks drafts through the controller", async () => {
    const orders = wired();
    const created = await orders.createDraftOrder({
      tenantId: "t-1",
      createdBy: "staff-1",
      currency: "EGP",
      content: CONTENT,
    });
    expect(created.status).toBe(201);
    const draft = (created.body as { draft: { id: string; draftNumber: string } }).draft;
    expect(draft.draftNumber).toBe("D1");

    expect((await orders.getDraftOrder({ tenantId: "t-1", draftId: draft.id })).status).toBe(200);
    expect((await orders.getDraftOrder({ tenantId: "t-2", draftId: draft.id })).status).toBe(404);

    const listed = await orders.listDraftOrders({ tenantId: "t-1" });
    expect(listed.status).toBe(200);
    expect((listed.body as { items: unknown[] }).items).toHaveLength(1);

    const stale = await orders.updateDraftOrder({
      tenantId: "t-1",
      draftId: draft.id,
      version: 5,
      content: CONTENT,
    });
    expect(stale.status).toBe(409);
  });
});
