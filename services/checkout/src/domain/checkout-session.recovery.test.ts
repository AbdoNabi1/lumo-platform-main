import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "./checkout-session";
import { CheckoutExpired } from "./events/checkout-expired.event";
import { CheckoutItem } from "./value-objects/checkout-item";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function open(options: { recoveredFromRef?: string } = {}): CheckoutSession {
  const session = CheckoutSession.start(
    UniqueEntityId.from("cs-original"),
    "cart-1",
    undefined,
    "session-1",
    "EGP",
    options,
  );
  session.loadItems([must(CheckoutItem.create("product-1", 1, 1000, "EGP"))]);
  session.pullDomainEvents();
  return session;
}

const AT = new Date("2026-10-18T12:00:00.000Z");

describe("CheckoutSession — recovery (order operations Part 3)", () => {
  it("a session starts with no recovery marks; a recovered one remembers where it came from", () => {
    expect(open().recoveredFromRef).toBeUndefined();
    expect(open().recoveredOrderRef).toBeUndefined();
    expect(open({ recoveredFromRef: "cs-abandoned" }).recoveredFromRef).toBe("cs-abandoned");
  });

  it("markRecovered stamps the order and expires a still-open original, so it can't be placed too", () => {
    const original = open();
    original.markRecovered("order-9", "evt-1", AT);
    expect(original.recoveredOrderRef).toBe("order-9");
    expect(original.state.value).toBe("expired");
    const events = original.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(CheckoutExpired);
    expect(() => original.loadItems([])).toThrow(BusinessRuleError);
  });

  it("expires a locked original too", () => {
    const original = open();
    original.lock("evt-lock", AT);
    original.markRecovered("order-9", "evt-1", AT);
    expect(original.state.value).toBe("expired");
  });

  it("only stamps an original that is already failed or expired", () => {
    const failed = open();
    failed.fail("declined", "evt-fail", AT);
    failed.pullDomainEvents();
    failed.markRecovered("order-9", "evt-1", AT);
    expect(failed.recoveredOrderRef).toBe("order-9");
    expect(failed.state.value).toBe("failed");
    expect(failed.pullDomainEvents()).toHaveLength(0);
  });

  it("marking twice keeps the first order", () => {
    const original = open();
    original.markRecovered("order-9", "evt-1", AT);
    original.markRecovered("order-10", "evt-2", AT);
    expect(original.recoveredOrderRef).toBe("order-9");
  });

  it("refuses to mark a completed checkout recovered", () => {
    const original = open();
    original.complete("order-1", "evt-complete", AT);
    expect(() => original.markRecovered("order-9", "evt-1", AT)).toThrow(BusinessRuleError);
    expect(original.recoveredOrderRef).toBeUndefined();
  });

  it("reconstitute carries both marks", () => {
    const loaded = CheckoutSession.reconstitute(
      UniqueEntityId.from("cs-1"),
      "cart-1",
      undefined,
      "session-1",
      "EGP",
      open().state,
      null,
      [],
      3,
      { recoveredFromRef: "cs-0", recoveredOrderRef: "order-1" },
    );
    expect(loaded.recoveredFromRef).toBe("cs-0");
    expect(loaded.recoveredOrderRef).toBe("order-1");
  });
});
