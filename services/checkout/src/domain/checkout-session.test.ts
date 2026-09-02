import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "./checkout-session";
import { CheckoutAddress } from "./value-objects/checkout-address";
import { CheckoutItem } from "./value-objects/checkout-item";
import { PaymentSelection, ShippingSelection } from "./value-objects/selections";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

function session(id = "cs-1"): CheckoutSession {
  return CheckoutSession.start(UniqueEntityId.from(id), "cart-1", "customer-1", "session-1", "USD");
}

function guestSession(id = "cs-guest"): CheckoutSession {
  return CheckoutSession.start(
    UniqueEntityId.from(id),
    "cart-guest",
    undefined,
    "session-guest",
    "USD",
  );
}

function item(productRef = "product-1", quantity = 2, unitPriceAmountMinor = 1000): CheckoutItem {
  return must(CheckoutItem.create(productRef, quantity, unitPriceAmountMinor, "USD"));
}

function address(): CheckoutAddress {
  return must(
    CheckoutAddress.create({
      line1: "1 Main St",
      city: "Springfield",
      postalCode: "00000",
      country: "US",
    }),
  );
}

describe("CheckoutSession", () => {
  it("starts in the started state with no events", () => {
    const cs = session();
    expect(cs.state.value).toBe("started");
    expect(cs.orderRef).toBeNull();
    expect(cs.pullDomainEvents()).toHaveLength(0);
  });

  it("supports a guest checkout (no customerRef)", () => {
    const cs = guestSession();
    expect(cs.isGuest).toBe(true);
    expect(cs.customerRef).toBeUndefined();
  });

  it("completes, recording the order and emitting checkout.completed", () => {
    const cs = session();
    cs.complete("order-1", "evt-1", new Date(0));
    expect(cs.state.value).toBe("completed");
    expect(cs.orderRef).toBe("order-1");
    const events = cs.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("checkout.completed");
  });

  it("fails, emitting checkout.failed", () => {
    const cs = session();
    cs.fail("payment_failed", "evt-1", new Date(0));
    expect(cs.state.value).toBe("failed");
    expect(cs.pullDomainEvents()[0]?.eventName).toBe("checkout.failed");
  });

  it("rejects completing a session that is not started/locked", () => {
    const cs = session();
    cs.fail("payment_failed", "evt-1", new Date(0));
    expect(() => cs.complete("order-1", "evt-2", new Date(0))).toThrow(BusinessRuleError);
  });

  it("locks a started session, emitting checkout_session.locked, and still allows completing a locked session", () => {
    const cs = session();
    cs.lock("evt-1", new Date(0));
    expect(cs.state.value).toBe("locked");
    expect(cs.pullDomainEvents()[0]?.eventName).toBe("checkout_session.locked");

    cs.complete("order-1", "evt-2", new Date(0));
    expect(cs.state.value).toBe("completed");
  });

  it("rejects locking a session that is not started", () => {
    const cs = session();
    cs.lock("evt-1", new Date(0));
    expect(() => cs.lock("evt-2", new Date(0))).toThrow(BusinessRuleError);
  });

  it("expires an open session, emitting checkout_session.expired, and rejects expiring a terminal session", () => {
    const cs = session();
    cs.expire("evt-1", new Date(0));
    expect(cs.state.value).toBe("expired");
    expect(cs.pullDomainEvents()[0]?.eventName).toBe("checkout_session.expired");

    const cs2 = session("cs-2");
    cs2.complete("order-1", "evt-2", new Date(0));
    expect(() => cs2.expire("evt-3", new Date(0))).toThrow(BusinessRuleError);
  });

  it("assembles totals as a sum of stored snapshots, emitting checkout_session.recalculated", () => {
    const cs = session();
    cs.loadItems([item("product-1", 2, 1000), item("product-2", 1, 500)]);
    cs.applyTaxSnapshot(100);
    cs.selectShipping(must(ShippingSelection.create("standard", 500, "USD")));
    cs.applyPromotionSnapshot(50);

    cs.recalculateTotals("evt-1", new Date(0));
    const totals = cs.totals;
    expect(totals?.subtotalMinor).toBe(2500);
    expect(totals?.totalMinor).toBe(2500 + 100 + 500 - 50);
    expect(cs.pullDomainEvents().some((e) => e.eventName === "checkout_session.recalculated")).toBe(
      true,
    );
  });

  it("rejects recalculating totals with no items", () => {
    const cs = session();
    expect(() => cs.recalculateTotals("evt-1", new Date(0))).toThrow(BusinessRuleError);
  });

  it("generates an order draft only once items/addresses/totals are all present", () => {
    const cs = session();
    expect(() => cs.generateOrderDraft()).toThrow(BusinessRuleError);

    cs.loadItems([item()]);
    cs.setBillingAddress(address());
    cs.setShippingAddress(address());
    expect(() => cs.generateOrderDraft()).toThrow(BusinessRuleError); // no totals yet

    cs.recalculateTotals("evt-1", new Date(0));
    const draft = cs.generateOrderDraft();
    expect(draft.items).toHaveLength(1);
    expect(draft.totals.totalMinor).toBeGreaterThan(0);
  });

  it("generates a payment intent request only once a payment selection and totals are present", () => {
    const cs = session();
    cs.loadItems([item()]);
    expect(() => cs.generatePaymentIntentRequest()).toThrow(BusinessRuleError);

    cs.selectPayment(must(PaymentSelection.create("pm-1", "stripe")));
    expect(() => cs.generatePaymentIntentRequest()).toThrow(BusinessRuleError); // no totals yet

    cs.recalculateTotals("evt-1", new Date(0));
    const request = cs.generatePaymentIntentRequest();
    expect(request.paymentMethodRef).toBe("pm-1");
    expect(request.amountMinor).toBe(cs.totals?.totalMinor);
  });
});
