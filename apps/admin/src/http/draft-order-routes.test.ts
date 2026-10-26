import { describe, expect, it } from "vitest";
import type { Principal } from "@platform/contracts";
import { BusinessRuleError, ConcurrencyError, toErrorEnvelope } from "@platform/utils";
import type { DraftOrderDto, DraftOrderListItemDto } from "./draft-order-dto";
import { withConflictCode } from "./draft-order-pricing";
import { unwrap } from "./testing/abandoned-harness";
import {
  createDraft,
  DRAFT_ADDRESS,
  draftBody,
  draftWorld,
  type DraftWorld,
} from "./testing/draft-harness";
import {
  adminStaff,
  HARNESS_TENANT,
  operatorStaff,
  placeTestOrder,
  viewerStaff,
} from "./testing/orders-harness";

const fieldsOf = (body: unknown) =>
  ((body as { fields?: { field: string }[] }).fields ?? []).map((f) => f.field);

/** Every key anywhere in a JSON body (objects inside arrays included). */
function keysOf(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysOf(inner, into);
    }
  }
  return into;
}

async function registerCustomer(
  world: DraftWorld,
  tenantId: string,
  name: string,
  email: string,
): Promise<string> {
  const staff: Principal = { ...adminStaff, tenantId };
  const response = await world.admin.customers.registerCustomer(staff, { tenantId, name, email });
  if (response.status !== 201) throw new Error(`register answered ${response.status}`);
  return (response.body as { customerId: string }).customerId;
}

describe("POST /draft-orders (spec §4.8)", () => {
  it("creates D1 with every price read from Catalog and the totals worked out by the API", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    expect(draft.draftNumber).toBe("D1");
    expect(draft.status).toBe("open");
    expect(draft.version).toBe(0);
    expect(draft.lines.map((l) => [l.sku, l.quantity, l.unitPriceMinor, l.lineTotalMinor])).toEqual(
      [
        // The VARIANT's sku (the seed names a single variant `<sku>-STD`).
        ["TEE-STD", 2, 25000, 50000],
        ["CAP-STD", 1, 9000, 9000],
      ],
    );
    expect(draft.discount).toEqual({
      valueType: "percentage",
      value: 10,
      reason: "Loyal customer",
      amountMinor: 5900,
    });
    expect(draft.totals).toMatchObject({
      subtotalMinor: 59000,
      discountMinor: 5900,
      shippingMinor: 4000,
    });
    expect(draft.totals.totalMinor).toBe(
      59000 - 5900 + 4000 + (draft.totals.taxIncluded ? 0 : (draft.totals.taxMinor ?? 0)),
    );
    expect(draft.missing).toEqual({ invoice: [], complete: [] });
    expect((await createDraft(world)).draftNumber).toBe("D2");
  });

  it("never accepts a price from the browser (binding carry 9)", async () => {
    const world = await draftWorld();
    const route = world.routes.find((r) => r.method === "POST" && r.path === "/draft-orders");
    const sneaky = draftBody(world, {
      lines: [
        {
          productId: world.tee.productId,
          variantId: world.tee.variantId,
          quantity: 1,
          unitPriceMinor: 1,
        },
      ],
    });
    expect(route?.schema.body?.safeParse(sneaky).success).toBe(false);
  });

  it("refuses an unsellable variant by line (Review Focus 3)", async () => {
    const world = await draftWorld();
    const refused = await world.staffCall(
      "POST",
      "/draft-orders",
      {
        body: draftBody(world, {
          lines: [
            {
              productId: world.tee.productId,
              variantId: "00000000-0000-7000-8000-00000000dead",
              quantity: 1,
            },
          ],
        }),
      },
      operatorStaff,
    );
    expect(refused.status).toBe(422);
    expect(fieldsOf(refused.body)).toContain("lines.0");
  });

  it("bounds the merchant's amounts and checks the province against the country", async () => {
    const world = await draftWorld();
    const over = async (o: Record<string, unknown>) =>
      world.staffCall("POST", "/draft-orders", { body: draftBody(world, o) }, operatorStaff);
    const route = world.routes.find((r) => r.method === "POST" && r.path === "/draft-orders");
    expect(
      route?.schema.body?.safeParse(
        draftBody(world, { shipping: { kind: "custom", title: "X", amountMinor: 10_000_001 } }),
      ).success,
    ).toBe(false);
    expect(
      route?.schema.body?.safeParse(
        draftBody(world, { discount: { valueType: "percentage", value: 101 } }),
      ).success,
    ).toBe(false);
    const province = await over({ shippingAddress: { ...DRAFT_ADDRESS, province: "SA-01" } });
    expect(province.status).toBe(422);
    expect(fieldsOf(province.body)).toContain("shippingAddress.province");
  });

  it("re-prices a shop rate from its method; an unknown method is refused", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world, { shipping: { kind: "rate", method: "express" } });
    expect(draft.shipping).toEqual({
      kind: "rate",
      method: "express",
      title: "Express",
      amountMinor: 1500,
    });
    const unknown = await world.staffCall(
      "POST",
      "/draft-orders",
      { body: draftBody(world, { shipping: { kind: "rate", method: "teleport" } }) },
      operatorStaff,
    );
    expect(unknown.status).toBe(422);
    expect(fieldsOf(unknown.body)).toContain("shipping.method");
  });

  it("an unknown customer is refused; viewers cannot create", async () => {
    const world = await draftWorld();
    const unknown = await world.staffCall(
      "POST",
      "/draft-orders",
      { body: draftBody(world, { customerId: "00000000-0000-7000-8000-00000000c0de" }) },
      operatorStaff,
    );
    expect(unknown.status).toBe(422);
    expect(fieldsOf(unknown.body)).toContain("customerId");
    expect(
      (await world.staffCall("POST", "/draft-orders", { body: draftBody(world) }, viewerStaff))
        .status,
    ).toBe(403);
  });
});

describe("the draft's customer belongs to this shop (Ruling 18)", () => {
  it("POST: this shop's customer is kept and fills an empty email; another shop's is refused", async () => {
    const world = await draftWorld();
    const mine = await registerCustomer(world, HARNESS_TENANT, "Hala Adel", "hala@example.com");
    const theirs = await registerCustomer(world, "shop-b", "Other Shop", "other@example.com");

    const kept = await createDraft(world, { customerId: mine, email: null });
    expect(kept.customer).toEqual({ id: mine, name: "Hala Adel", email: "hala@example.com" });
    expect(kept.email).toBe("hala@example.com");
    const blank = await createDraft(world, { customerId: mine, email: "  " });
    expect(blank.email).toBe("hala@example.com");
    // A typed email wins over the customer's.
    expect((await createDraft(world, { customerId: mine })).email).toBe("sara@example.com");

    const refused = await world.staffCall(
      "POST",
      "/draft-orders",
      { body: draftBody(world, { customerId: theirs }) },
      operatorStaff,
    );
    expect(refused.status).toBe(422);
    expect(fieldsOf(refused.body)).toContain("customerId");
  });

  it("PUT runs the same check: another shop's customer is refused and nothing changes", async () => {
    const world = await draftWorld();
    const mine = await registerCustomer(world, HARNESS_TENANT, "Hala Adel", "hala@example.com");
    const theirs = await registerCustomer(world, "shop-b", "Other Shop", "other@example.com");
    const draft = await createDraft(world);
    const params = { draftId: draft.id };

    const refused = await world.staffCall(
      "PUT",
      "/draft-orders/:draftId",
      { params, body: { ...draftBody(world, { customerId: theirs }), version: 0 } },
      operatorStaff,
    );
    expect(refused.status).toBe(422);
    expect(fieldsOf(refused.body)).toContain("customerId");
    const unchanged = unwrap<DraftOrderDto>(
      await world.staffCall("GET", "/draft-orders/:draftId", { params }, viewerStaff),
      "get",
    );
    expect(unchanged.version).toBe(0);
    expect(unchanged.customer).toBeNull();

    const updated = unwrap<DraftOrderDto>(
      await world.staffCall(
        "PUT",
        "/draft-orders/:draftId",
        { params, body: { ...draftBody(world, { customerId: mine, email: null }), version: 0 } },
        operatorStaff,
      ),
      "update",
    );
    expect(updated.customer?.id).toBe(mine);
    expect(updated.email).toBe("hala@example.com");
  });
});

describe("GET / PUT / DELETE /draft-orders/:draftId", () => {
  it("viewers read it; operators update it with the version; a stale version is 409 VERSION_CONFLICT", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const params = { draftId: draft.id };
    expect(
      (await world.staffCall("GET", "/draft-orders/:draftId", { params }, viewerStaff)).status,
    ).toBe(200);
    const updated = unwrap<DraftOrderDto>(
      await world.staffCall(
        "PUT",
        "/draft-orders/:draftId",
        { params, body: { ...draftBody(world, { note: "new" }), version: 0 } },
        operatorStaff,
      ),
      "update",
    );
    expect(updated.version).toBe(1);
    expect(updated.note).toBe("new");
    const stale = await world.staffCall(
      "PUT",
      "/draft-orders/:draftId",
      { params, body: { ...draftBody(world), version: 0 } },
      operatorStaff,
    );
    expect(stale.status).toBe(409);
    expect((stale.body as { code: string }).code).toBe("VERSION_CONFLICT");
  });

  it("delete is soft: 404 afterwards and gone from the list; a garbage id is 404", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    expect(
      (
        await world.staffCall(
          "DELETE",
          "/draft-orders/:draftId",
          { params: { draftId: draft.id } },
          operatorStaff,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await world.staffCall(
          "GET",
          "/draft-orders/:draftId",
          { params: { draftId: draft.id } },
          adminStaff,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await world.staffCall(
          "GET",
          "/draft-orders/:draftId",
          { params: { draftId: "abc" } },
          adminStaff,
        )
      ).status,
    ).toBe(404);
    const page = unwrap<{ items: DraftOrderListItemDto[] }>(
      await world.staffCall("GET", "/draft-orders", {}, viewerStaff),
      "list",
    );
    expect(page.items).toEqual([]);
  });

  it("a completed draft cannot be changed or deleted (409 DRAFT_COMPLETED)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    // A real order of this shop: Orders refuses to close a draft on an order it cannot see.
    const orderRef = await placeTestOrder(world.admin);
    const completed = await world.admin.publicReads.draftOrders.completeDraftFromCheckout({
      tenantId: HARNESS_TENANT,
      draftId: draft.id,
      orderRef,
    });
    expect(completed.status).toBe(200);
    const params = { draftId: draft.id };
    const read = unwrap<DraftOrderDto>(
      await world.staffCall("GET", "/draft-orders/:draftId", { params }, viewerStaff),
      "get",
    );
    expect(read.status).toBe("completed");
    expect(read.order?.id).toBe(orderRef);
    expect(read.order?.orderNumber).toEqual(expect.any(String));
    const put = await world.staffCall(
      "PUT",
      "/draft-orders/:draftId",
      { params, body: { ...draftBody(world), version: 0 } },
      operatorStaff,
    );
    const del = await world.staffCall(
      "DELETE",
      "/draft-orders/:draftId",
      { params },
      operatorStaff,
    );
    for (const reply of [put, del]) {
      expect(reply.status).toBe(409);
      expect((reply.body as { code: string }).code).toBe("DRAFT_COMPLETED");
      expect((reply.body as { message: string }).message).toMatch(/^DRAFT_COMPLETED:/);
    }
  });
});

describe("GET /draft-orders", () => {
  it("lists newest first with the customer's name, total and status; filters by status and #number", async () => {
    const world = await draftWorld();
    await createDraft(world);
    await createDraft(world, { shippingAddress: { ...DRAFT_ADDRESS, name: "Omar" } });
    const page = unwrap<{ items: DraftOrderListItemDto[] }>(
      await world.staffCall("GET", "/draft-orders", {}, viewerStaff),
      "list",
    );
    expect(page.items.map((d) => [d.draftNumber, d.customerName, d.status])).toEqual([
      ["D2", "Omar", "open"],
      ["D1", "Mona Ali", "open"],
    ]);
    expect(page.items[0]?.totalMinor).toBe(59000 - 5900 + 4000);
    const found = unwrap<{ items: DraftOrderListItemDto[] }>(
      await world.staffCall("GET", "/draft-orders", { query: { q: "#D1" } }, viewerStaff),
      "search",
    );
    expect(found.items.map((d) => d.draftNumber)).toEqual(["D1"]);
  });
});

describe("POST /draft-orders/:draftId/shipping-rates", () => {
  it("answers the shop's rates for the saved address; refuses without an address; viewers are refused", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const rates = unwrap<{ rates: { method: string; title: string; amountMinor: number }[] }>(
      await world.staffCall(
        "POST",
        "/draft-orders/:draftId/shipping-rates",
        { params: { draftId: draft.id } },
        operatorStaff,
      ),
      "rates",
    );
    expect(rates.rates).toEqual([
      { method: "standard", title: "Standard", amountMinor: 500 },
      { method: "express", title: "Express", amountMinor: 1500 },
    ]);
    const bare = await createDraft(world, { shippingAddress: null, shipping: null });
    expect(bare.missing.invoice).toEqual(["shipping_address", "shipping"]);
    expect(
      (
        await world.staffCall(
          "POST",
          "/draft-orders/:draftId/shipping-rates",
          { params: { draftId: bare.id } },
          operatorStaff,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await world.staffCall(
          "POST",
          "/draft-orders/:draftId/shipping-rates",
          { params: { draftId: draft.id } },
          viewerStaff,
        )
      ).status,
    ).toBe(403);
  });
});

describe("the DTOs never serialize a domain object", () => {
  it("no `props`, `persisted` or `tokenHash` key in any draft answer (links included)", async () => {
    const world = await draftWorld();
    const draft = await createDraft(world);
    const params = { draftId: draft.id };
    unwrap(
      await world.admin.publicReads.checkout.issueInvoiceLink({
        tenantId: HARNESS_TENANT,
        draftOrderRef: draft.id,
        createdBy: operatorStaff.id,
      }),
      "issue link",
    );
    const read = await world.staffCall("GET", "/draft-orders/:draftId", { params }, viewerStaff);
    expect((read.body as DraftOrderDto).links).toEqual([
      expect.objectContaining({ claimCount: 0, lastClaimedAt: null }),
    ]);
    const answers = [
      draft,
      read.body,
      (
        await world.staffCall(
          "PUT",
          "/draft-orders/:draftId",
          { params, body: { ...draftBody(world, { note: "x" }), version: 0 } },
          operatorStaff,
        )
      ).body,
      (await world.staffCall("GET", "/draft-orders", {}, viewerStaff)).body,
      (await world.staffCall("DELETE", "/draft-orders/:draftId", { params }, operatorStaff)).body,
    ];
    for (const body of answers) {
      const keys = keysOf(JSON.parse(JSON.stringify(body)));
      expect(keys.has("props")).toBe(false);
      expect(keys.has("persisted")).toBe(false);
      expect(keys.has("tokenHash")).toBe(false);
    }
  });
});

describe("withConflictCode (Ruling 19: every draft 409 carries its own code)", () => {
  const conflict = (error: Error) => ({ status: 409, body: toErrorEnvelope(error) });
  const codeOf = (response: { body: unknown }) => (response.body as { code: string }).code;

  it("keeps DRAFT_COMPLETED, DRAFT_TOTAL_TOO_LARGE and VERSION_CONFLICT as they are", () => {
    expect(
      codeOf(withConflictCode(conflict(new BusinessRuleError("DRAFT_COMPLETED: already")))),
    ).toBe("DRAFT_COMPLETED");
    expect(
      codeOf(withConflictCode(conflict(new BusinessRuleError("DRAFT_TOTAL_TOO_LARGE: too big")))),
    ).toBe("DRAFT_TOTAL_TOO_LARGE");
    // Never relabelled DRAFT_BUSY.
    expect(
      codeOf(withConflictCode(conflict(new ConcurrencyError("VERSION_CONFLICT: changed")))),
    ).toBe("VERSION_CONFLICT");
  });

  it("leaves a 409 without a prefix, and every other status, alone", () => {
    const plain = conflict(new BusinessRuleError("no prefix here"));
    expect(withConflictCode(plain)).toBe(plain);
    const notFound = { status: 404, body: { message: "DRAFT_COMPLETED: not a 409" } };
    expect(withConflictCode(notFound)).toBe(notFound);
  });
});
