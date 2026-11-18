import { describe, expect, it } from "vitest";
import { orderListWhere, orderPageSize, recipientSearchWhere, uuidsOf } from "./order-list-where";

const UUID_A = "0192f3a1-0000-7000-8000-000000000001";
const UUID_B = "0192f3a1-0000-7000-8000-000000000009";

describe("orderListWhere (order operations Part 1)", () => {
  it("scopes to the tenant and adds nothing for an empty query", () => {
    expect(orderListWhere({}, "t-1", undefined, [])).toEqual({ tenantId: "t-1" });
  });

  it("archived true → archived_at IS NOT NULL; false → IS NULL", () => {
    expect(orderListWhere({ archived: true }, "t-1", undefined, [])).toEqual({
      tenantId: "t-1",
      archivedAt: { not: null },
    });
    expect(orderListWhere({ archived: false }, "t-1", undefined, [])).toEqual({
      tenantId: "t-1",
      archivedAt: null,
    });
  });

  it("open true → NOT EXISTS a cancelled or closed event; false → EXISTS", () => {
    expect(orderListWhere({ open: true }, "t-1", undefined, [])).toEqual({
      tenantId: "t-1",
      AND: [{ events: { none: { type: { in: ["cancelled", "closed"] } } } }],
    });
    expect(orderListWhere({ open: false }, "t-1", undefined, [])).toEqual({
      tenantId: "t-1",
      AND: [{ events: { some: { type: { in: ["cancelled", "closed"] } } } }],
    });
  });

  it("paymentStatus pending → NOT EXISTS a paid, refunded or cancelled event", () => {
    expect(orderListWhere({ paymentStatus: "pending" }, "t-1", undefined, [])).toEqual({
      tenantId: "t-1",
      AND: [
        {
          events: {
            none: {
              type: {
                in: ["paid", "payment_received", "refunded", "refund_requested", "cancelled"],
              },
            },
          },
        },
      ],
    });
  });

  it("the Unpaid tab combines both NOT EXISTS predicates with archived = null", () => {
    const where = orderListWhere(
      { open: true, paymentStatus: "pending", archived: false },
      "t-1",
      undefined,
      [],
    );
    expect(where.archivedAt).toBeNull();
    expect(where.AND).toHaveLength(2);
  });

  it("ids keep only UUID-shaped ids (a uuid column cannot hold anything else) and join the cursor", () => {
    expect(orderListWhere({ ids: [UUID_A, "not-a-uuid", UUID_A] }, "t-1", UUID_B, [])).toEqual({
      tenantId: "t-1",
      id: { lt: UUID_B, in: [UUID_A] },
    });
  });

  it("dates filter the entry event's time: from inclusive, to exclusive", () => {
    const from = new Date("2026-10-01T00:00:00.000Z");
    const to = new Date("2026-10-02T00:00:00.000Z");
    expect(orderListWhere({ createdFrom: from, createdTo: to }, "t-1", undefined, [])).toEqual({
      tenantId: "t-1",
      AND: [
        {
          events: {
            some: { type: { in: ["placed", "created"] }, occurredAt: { gte: from, lt: to } },
          },
        },
      ],
    });
  });

  it("search ORs the order number, the customer ref and the recipient matches", () => {
    expect(orderListWhere({ search: " mona " }, "t-1", undefined, [UUID_A])).toEqual({
      tenantId: "t-1",
      OR: [
        { orderNumber: { contains: "mona", mode: "insensitive" } },
        { customerRef: { contains: "mona", mode: "insensitive" } },
        { id: { in: [UUID_A] } },
      ],
    });
  });

  it("a blank search adds nothing", () => {
    expect(orderListWhere({ search: "   " }, "t-1", undefined, [])).toEqual({ tenantId: "t-1" });
  });

  it("tags → one EXISTS over order_tags per distinct key (AND), case-insensitive, blanks ignored (Part 2)", () => {
    expect(
      orderListWhere({ tags: [" VIP ", "Urgent", "vip", "  "] }, "t-1", undefined, []),
    ).toEqual({
      tenantId: "t-1",
      AND: [
        { tags: { some: { tenantId: "t-1", tagKey: "vip" } } },
        { tags: { some: { tenantId: "t-1", tagKey: "urgent" } } },
      ],
    });
  });

  it("an empty tags list adds nothing", () => {
    expect(orderListWhere({ tags: [] }, "t-1", undefined, [])).toEqual({ tenantId: "t-1" });
  });
});

describe("recipientSearchWhere", () => {
  it("matches the name case-insensitively and the phone in each typed form", () => {
    expect(recipientSearchWhere(" 010 1234 5678 ", "t-1")).toEqual({
      tenantId: "t-1",
      OR: [
        { recipientName: { contains: "010 1234 5678", mode: "insensitive" } },
        { phone: { contains: "010 1234 5678" } },
        { phone: { contains: "01012345678" } },
        { phone: { contains: "1012345678" } },
      ],
    });
  });
});

describe("orderPageSize", () => {
  it("defaults like every other repository and caps at 250, not 100", () => {
    expect(orderPageSize(undefined)).toBe(50);
    expect(orderPageSize(250)).toBe(250);
    expect(orderPageSize(1000)).toBe(250);
    expect(orderPageSize(0)).toBe(1);
  });
});

describe("uuidsOf", () => {
  it("dedupes and drops anything that is not a UUID", () => {
    expect(uuidsOf([UUID_A, "abc", UUID_A, UUID_B])).toEqual([UUID_A, UUID_B]);
  });
});
