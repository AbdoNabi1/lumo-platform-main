import { describe, expect, it } from "vitest";
import { EVENT_TYPE_PATTERN, topicFor } from "./topic";

describe("topicFor", () => {
  it("builds a versioned topic name", () => {
    expect(topicFor("orders.order.placed", 1)).toBe("orders.order.placed.v1");
    expect(topicFor("catalog.product.published", 3)).toBe("catalog.product.published.v3");
  });

  it("rejects a malformed event type", () => {
    expect(() => topicFor("order.placed", 1)).toThrow();
    expect(() => topicFor("Orders.Order.Placed", 1)).toThrow();
    expect(() => topicFor("orders..placed", 1)).toThrow();
  });

  it("rejects a non-positive or non-integer version", () => {
    expect(() => topicFor("orders.order.placed", 0)).toThrow();
    expect(() => topicFor("orders.order.placed", -1)).toThrow();
    expect(() => topicFor("orders.order.placed", 1.5)).toThrow();
  });
});

describe("EVENT_TYPE_PATTERN", () => {
  it("matches three lower snake-case segments", () => {
    expect(EVENT_TYPE_PATTERN.test("inventory.stock_item.reserved")).toBe(true);
    expect(EVENT_TYPE_PATTERN.test("two.segments")).toBe(false);
  });
});
