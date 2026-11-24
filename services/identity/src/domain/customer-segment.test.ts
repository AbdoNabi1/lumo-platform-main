import { UniqueEntityId } from "@platform/domain";
import { describe, expect, it } from "vitest";
import {
  CustomerSegment,
  DEFAULT_SEGMENTS,
  isDefaultSegmentId,
  parseSegmentConditions,
  segmentNameKey,
} from "./customer-segment";

describe("customer segment conditions", () => {
  it("accepts every field and operator family", () => {
    const conditions = [
      { field: "orders_count", op: "gte", value: 1 },
      { field: "amount_spent", op: "lte", valueMinor: 100 },
      { field: "last_order_date", op: "within_last_days", days: 30 },
      { field: "last_order_date", op: "before", date: "2024-02-29" },
      { field: "last_order_date", op: "never" },
      { field: "email_subscribed", value: true },
      { field: "sms_subscribed", value: false },
      { field: "tags", op: "has_any", values: ["VIP"] },
      { field: "country", op: "in", values: ["EG"] },
      { field: "created_date", op: "on_or_after", date: "2026-01-01" },
    ];
    expect(parseSegmentConditions(conditions)).toEqual({ ok: true, value: conditions });
    for (const condition of [
      { field: "created_date", op: "not_within_last_days", days: 1 },
      { field: "language", op: "eq", value: "ar" },
      { field: "language", op: "unset" },
    ])
      expect(parseSegmentConditions([condition]).ok).toBe(true);
  });
  it.each([-1, 1.5])("rejects invalid orders count %s", (value) => {
    const result = parseSegmentConditions([{ field: "orders_count", op: "eq", value }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.fields.map((x) => x.field)).toContain("conditions.0.value");
  });
  it("reports array length, unknown fields and impossible dates", () => {
    for (const [input, field] of [
      [Array(11).fill({ field: "email_subscribed", value: true }), "conditions"],
      [[{ field: "unknown" }], "conditions.0.field"],
      [[{ field: "created_date", op: "before", date: "2026-02-30" }], "conditions.0.date"],
    ] as const) {
      const result = parseSegmentConditions(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.fields.map((x) => x.field)).toContain(field);
    }
  });
  it("normalizes and deduplicates tags and countries while retaining first tag spelling", () => {
    expect(
      parseSegmentConditions([
        { field: "tags", op: "has_all", values: ["VIP", " vip ", "Cairo"] },
        { field: "country", op: "in", values: [" eg ", "US"] },
      ]),
    ).toEqual({
      ok: true,
      value: [
        { field: "tags", op: "has_all", values: ["VIP", "Cairo"] },
        { field: "country", op: "in", values: ["EG", "US"] },
      ],
    });
  });
  it("rejects 21 distinct tags and invalid countries", () => {
    const result = parseSegmentConditions([
      { field: "tags", op: "has_none", values: Array.from({ length: 21 }, (_, i) => `tag${i}`) },
      { field: "country", op: "in", values: ["EGY"] },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.fields.map((x) => x.field)).toEqual([
        "conditions.0.values",
        "conditions.1.values",
      ]);
  });
  it("collects multiple problems in one validation error", () => {
    const result = parseSegmentConditions([
      { field: "orders_count", op: "bad", value: -1 },
      null,
      { field: "email_subscribed", value: 1 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.fields.map((x) => x.field)).toEqual([
        "conditions.0.op",
        "conditions.0.value",
        "conditions.1",
        "conditions.2.value",
      ]);
  });
});

describe("segment name and defaults", () => {
  it("normalizes names to NFC and collapses whitespace", () => {
    expect(segmentNameKey("  VIP   Buyers ")).toBe("vip buyers");
    expect(segmentNameKey("Cafe\u0301")).toBe("café");
  });
  it("declares four ordered default segments and recognizes the reserved prefix", () => {
    expect(DEFAULT_SEGMENTS).toEqual([
      {
        id: "default:purchased_at_least_once",
        key: "purchasedAtLeastOnce",
        conditions: [{ field: "orders_count", op: "gte", value: 1 }],
      },
      {
        id: "default:email_subscribers",
        key: "emailSubscribers",
        conditions: [{ field: "email_subscribed", value: true }],
      },
      {
        id: "default:purchased_more_than_once",
        key: "purchasedMoreThanOnce",
        conditions: [{ field: "orders_count", op: "gt", value: 1 }],
      },
      {
        id: "default:not_purchased",
        key: "notPurchased",
        conditions: [{ field: "orders_count", op: "eq", value: 0 }],
      },
    ]);
    expect(isDefaultSegmentId("default:any")).toBe(true);
    expect(isDefaultSegmentId("custom")).toBe(false);
  });
  it("changes aggregate fields without changing the persisted version or raising events", () => {
    const id = UniqueEntityId.from("abc");
    const now = new Date("2026-01-01T00:00:00Z");
    const later = new Date("2026-01-02T00:00:00Z");
    const conditions = DEFAULT_SEGMENTS[0]!.conditions;
    const segment = CustomerSegment.create(id, "VIP", conditions, "staff", now);
    expect(segment.version).toBe(0);
    const restored = CustomerSegment.reconstitute(
      id,
      segment.name,
      conditions,
      3,
      "staff",
      now,
      now,
    );
    restored.rename("  Loyal   Buyers ", later);
    restored.replaceConditions(DEFAULT_SEGMENTS[1]!.conditions, later);
    expect(restored.nameKey).toBe("loyal buyers");
    expect(restored.version).toBe(3);
    expect(restored.updatedAt).toEqual(later);
    expect(restored.domainEvents).toEqual([]);
  });
});
