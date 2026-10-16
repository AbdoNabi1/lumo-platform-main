import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import type {
  AppliedDiscountSnapshot,
  DiscountSnapshot,
} from "../domain/value-objects/discount-snapshot";
import { ShippingSelection } from "../domain/value-objects/selections";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { RecalculateTotals, RequestTaxCalculation } from "./checkout-orchestration.use-cases";
import { AddDiscountCode, RemoveDiscountCode } from "./discount-code.use-cases";
import type { DiscountEvaluationInput, PromotionValidationPort, TaxCalculationPort } from "./ports";

class FakeSessions implements CheckoutSessionRepository {
  readonly store = new Map<string, CheckoutSession>();
  async save(session: CheckoutSession): Promise<void> {
    this.store.set(session.id.toString(), session);
  }
  async findById(id: string): Promise<CheckoutSession | null> {
    return this.store.get(id) ?? null;
  }
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

/** Stands in for Promotions: SALE10 = 10% off orders of 10,000 or more; SHIPFREE = free shipping; anything else is unknown. */
class FakePromotions implements PromotionValidationPort {
  readonly calls: DiscountEvaluationInput[] = [];
  async validate() {
    return { valid: true, discountMinor: 0 };
  }
  async evaluate(input: DiscountEvaluationInput): Promise<DiscountSnapshot> {
    this.calls.push(input);
    const subtotal = input.items.reduce((s, i) => s + i.lineTotalMinor, 0);
    const applied: AppliedDiscountSnapshot[] = [];
    const codeStatuses = input.codes.map((code) => {
      if (code === "SALE10") {
        if (subtotal < 10_000) return { code, applicable: false, reason: "minimum_not_met" };
        applied.push({
          promotionId: "p-sale",
          code,
          title: code,
          discountClass: "order",
          amountMinor: subtotal / 10,
        });
        return { code, applicable: true };
      }
      if (code === "SHIPFREE") {
        applied.push({
          promotionId: "p-ship",
          code,
          title: code,
          discountClass: "shipping",
          amountMinor: input.shipping?.rateMinor ?? 0,
        });
        return { code, applicable: true };
      }
      return { code, applicable: false, reason: "not_found" };
    });
    const sum = (cls: (c: string) => boolean) =>
      applied.filter((a) => cls(a.discountClass)).reduce((s, a) => s + a.amountMinor, 0);
    return {
      applied,
      orderDiscountMinor: sum((c) => c !== "shipping"),
      shippingDiscountMinor: sum((c) => c === "shipping"),
      codeStatuses,
      lineAllocations: [],
    };
  }
}

/** Stands in for Finance: 14% on what is left after the order discount (shipping is not taxed). */
const fakeTax: TaxCalculationPort = {
  async calculate(items, _destination, _shippingMinor, _currency, _tenantId, discounts) {
    const subtotal = items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
    return {
      taxMinor: Math.floor(((subtotal - (discounts?.orderMinor ?? 0)) * 14) / 100),
      included: false,
    };
  },
};

const clock = { now: () => new Date("2026-10-16T12:00:00.000Z") };
let n = 0;
const idGenerator = { generate: () => `id-${(n += 1)}` };

function setup(quantity = 2) {
  const sessions = new FakeSessions();
  const session = CheckoutSession.start(
    UniqueEntityId.from("cs-1"),
    "cart-1",
    undefined,
    "s-1",
    "EGP",
  );
  session.loadItems([must(CheckoutItem.create("prod-1", quantity, 5_000, "EGP"))]);
  session.setShippingAddress(
    must(
      CheckoutAddress.create({ line1: "1 Main St", city: "Cairo", postalCode: "", country: "EG" }),
    ),
  );
  sessions.store.set("cs-1", session);
  const promotionValidation = new FakePromotions();
  const deps = {
    sessions,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator,
    clock,
    promotionValidation,
    taxCalculation: fakeTax,
  };
  const input = (code: string) => ({ tenantId: "t1", checkoutSessionId: "cs-1", code });
  return {
    session,
    promotionValidation,
    add: (code: string) => new AddDiscountCode(deps).execute(input(code)),
    remove: (code: string) => new RemoveDiscountCode(deps).execute(input(code)),
    recalculate: () =>
      new RecalculateTotals(deps).execute({ tenantId: "t1", checkoutSessionId: "cs-1" }),
    requestTax: () =>
      new RequestTaxCalculation(deps).execute({ tenantId: "t1", checkoutSessionId: "cs-1" }),
    recalculateWithoutTaxPort: () =>
      new RecalculateTotals({ ...deps, taxCalculation: undefined }).execute({
        tenantId: "t1",
        checkoutSessionId: "cs-1",
      }),
  };
}

describe("AddDiscountCode / RemoveDiscountCode (Phase 2)", () => {
  it("accepts a code typed in any case with spaces, and takes it off the total (Review Focus 1)", async () => {
    const t = setup();
    const result = await t.add(" sale10 ");
    expect(result.ok && result.value).toMatchObject({ code: "SALE10", applicable: true });
    expect(t.session.discountCodes).toEqual(["SALE10"]);
    expect(t.session.totals?.discountMinor).toBe(1_000);
  });

  it("refuses an unknown code, forgets it and counts the attempt", async () => {
    const t = setup();
    const result = await t.add("NOPE");
    expect(result.ok && result.value).toMatchObject({ applicable: false, reason: "not_found" });
    expect(t.session.discountCodes).toEqual([]);
    expect(t.session.rejectedCodeAttempts).toBe(1);
  });

  it("answers too_many_attempts after ten rejected codes", async () => {
    const t = setup();
    for (let i = 0; i < 10; i += 1) await t.add(`BAD${i}X`);
    const result = await t.add("SALE10");
    expect(result.ok && result.value).toMatchObject({
      applicable: false,
      reason: "too_many_attempts",
    });
  });

  it("keeps a code that stops qualifying, as not applicable, with a correct total (Review Focus 2)", async () => {
    const t = setup(2);
    await t.add("SALE10");
    t.session.loadItems([must(CheckoutItem.create("prod-1", 1, 5_000, "EGP"))]);
    await t.recalculate();
    expect(t.session.discountCodes).toEqual(["SALE10"]);
    expect(t.session.discountSnapshot?.codeStatuses).toEqual([
      { code: "SALE10", applicable: false, reason: "minimum_not_met" },
    ]);
    expect(t.session.totals?.discountMinor).toBe(0);
    expect(t.session.totals?.totalMinor).toBe(5_000);
  });

  it("accepts free shipping before a method is chosen, then makes shipping free (Review Focus 5)", async () => {
    const t = setup();
    const result = await t.add("SHIPFREE");
    expect(result.ok && result.value).toMatchObject({ applicable: true });
    expect(t.promotionValidation.calls.at(-1)?.shipping).toBeNull();
    t.session.selectShipping(must(ShippingSelection.create("std", 6_000, "EGP")));
    await t.recalculate();
    expect(t.session.totals?.shippingMinor).toBe(6_000);
    expect(t.session.totals?.shippingDiscountMinor).toBe(6_000);
    expect(t.session.totals?.totalMinor).toBe(10_000);
  });

  it("removes a code and its discount", async () => {
    const t = setup();
    await t.add("SALE10");
    await t.remove("sale10");
    expect(t.session.discountCodes).toEqual([]);
    expect(t.session.totals?.discountMinor).toBe(0);
  });

  it("sends Promotions the lines, the tenant and the codes", async () => {
    const t = setup();
    await t.add("SALE10");
    const call = t.promotionValidation.calls.at(-1);
    expect(call?.codes).toEqual(["SALE10"]);
    expect(call?.items).toHaveLength(1);
    expect(call?.tenantId).toBe("t1");
  });

  it("re-works the tax when a code changes the discount after tax was requested", async () => {
    const t = setup();
    await t.requestTax();
    expect(t.session.taxMinor).toBe(1_400);

    await t.add("SALE10");
    expect(t.session.taxMinor).toBe(1_260);
    expect(t.session.totals?.taxMinor).toBe(1_260);
    expect(t.session.totals?.totalMinor).toBe(9_000 + 1_260);

    await t.remove("SALE10");
    expect(t.session.taxMinor).toBe(1_400);
    expect(t.session.totals?.totalMinor).toBe(10_000 + 1_400);
  });

  it("re-works the tax in RecalculateTotals when an item change moves the discount", async () => {
    const t = setup(2);
    await t.add("SALE10");
    await t.requestTax();
    expect(t.session.taxMinor).toBe(1_260);
    t.session.loadItems([must(CheckoutItem.create("prod-1", 1, 5_000, "EGP"))]);
    await t.recalculate();
    expect(t.session.totals?.discountMinor).toBe(0);
    expect(t.session.taxMinor).toBe(700);
    expect(t.session.totals?.totalMinor).toBe(5_000 + 700);
  });

  it("does not tax a session that never asked for tax", async () => {
    const t = setup();
    await t.add("SALE10");
    expect(t.session.taxMinor).toBeUndefined();
    expect(t.session.totals?.taxMinor ?? 0).toBe(0);
  });

  it("leaves the stored tax alone when no tax port is wired", async () => {
    const t = setup();
    await t.requestTax();
    t.session.enterDiscountCode("SALE10");
    await t.recalculateWithoutTaxPort();
    expect(t.session.totals?.discountMinor).toBe(1_000);
    expect(t.session.taxMinor).toBe(1_400);
  });

  it("keeps a legacy promotion snapshot through RecalculateTotals when nothing applies", async () => {
    const t = setup();
    t.session.applyPromotionSnapshot(500);
    await t.recalculate();
    expect(t.session.totals?.discountMinor).toBe(500);
    expect(t.session.discountSnapshot).toBeUndefined();
  });
});
