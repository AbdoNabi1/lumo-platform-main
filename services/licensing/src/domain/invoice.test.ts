import { describe, expect, it } from "vitest";
import { Money, UniqueEntityId } from "@platform/domain";
import { Invoice } from "./invoice";

/**
 * WP-14 (Trap 3): `Invoice.total` used to be `lineItems.reduce((sum, item) => sum + item.amount, 0)`
 * over `number`s — the F-07 float defect WP-11 closed for the Decimal columns, still live in the
 * arithmetic of the number Morbeh is about to charge. `lineItems` is a JSONB column, so it escaped
 * that migration. The convention now (see `Invoice`'s class doc): every amount is an INTEGER in the
 * currency's minor units, the same convention `payments`' `amountMinor` and the shared-kernel `Money`
 * already use, so addition is exact by construction.
 */
const ID = UniqueEntityId.from("inv-1");
const NOW = new Date("2026-09-24T00:00:00.000Z");

function draft(lines: readonly { description: string; amountMinor: number }[], currency = "USD") {
  return Invoice.createDraft(ID, "merchant-1", "sub-1", currency, lines, "e1", NOW);
}

describe("Invoice money (WP-14 Trap 3)", () => {
  it("sums line items exactly where the float major-unit sum drifts", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in binary floating point. As minor units it is 10 + 20.
    expect(0.1 + 0.2).not.toBe(0.3);
    const invoice = draft([
      { description: "seat", amountMinor: 10 },
      { description: "seat", amountMinor: 20 },
    ]);
    expect(invoice.totalMinor).toBe(30);
  });

  it("stays exact across many small lines (1000 x 1 minor unit)", () => {
    const lines = Array.from({ length: 1000 }, () => ({ description: "x", amountMinor: 1 }));
    expect(draft(lines).totalMinor).toBe(1000);
    // The float major-unit equivalent (1000 x 0.01) does not land on 10 exactly.
    let floatTotal = 0;
    for (let i = 0; i < 1000; i += 1) floatTotal += 0.01;
    expect(floatTotal).not.toBe(10);
  });

  it("exposes the total as canonical Money carrying the invoice currency", () => {
    const invoice = draft([{ description: "plan", amountMinor: 2900 }], "EGP");
    expect(invoice.total.amountMinor).toBe(2900);
    expect(invoice.total.currency).toBe("EGP");
  });

  it("refuses a fractional amount — it is not a minor-unit integer", () => {
    expect(() => draft([{ description: "plan", amountMinor: 29.99 }])).toThrow(/minor/i);
    expect(() => draft([{ description: "plan", amountMinor: 0.1 }])).toThrow(/minor/i);
  });

  it("refuses a negative amount (a discount is not a negative line — see Invoice discount below)", () => {
    expect(() => draft([{ description: "plan", amountMinor: -1 }])).toThrow(/minor/i);
  });

  it("refuses a malformed currency", () => {
    expect(() => draft([{ description: "plan", amountMinor: 1 }], "usd")).toThrow(/currency/i);
  });

  it("refuses a total that exceeds the exactly-representable integer range", () => {
    expect(() =>
      draft([
        { description: "a", amountMinor: Number.MAX_SAFE_INTEGER },
        { description: "b", amountMinor: 1 },
      ]),
    ).toThrow(/exceeds/i);
  });

  it("a failed invoice can be re-issued for a later retry (failed -> issued)", () => {
    const invoice = draft([{ description: "plan", amountMinor: 2900 }]);
    invoice.issue("e2", NOW);
    invoice.markFailed("e3", NOW);
    expect(invoice.status).toBe("failed");
    invoice.issue("e4", NOW);
    expect(invoice.status).toBe("issued");
  });

  it("a paid invoice cannot fail or be re-issued", () => {
    const invoice = draft([{ description: "plan", amountMinor: 2900 }]);
    invoice.issue("e2", NOW);
    invoice.markPaid("ref-1", "e3", NOW);
    expect(() => invoice.markFailed("e4", NOW)).toThrow();
    expect(() => invoice.issue("e5", NOW)).toThrow();
  });
});

/**
 * WP-14 T14.3 (coupons): `Money` is non-negative, so a discount is NOT a negative line item. It is a
 * separate, single, optional `discount` carried beside the lines: `subtotal` is the exact sum of the
 * lines (unchanged), `total = subtotal.minus(discount)` — and `Money.minus` is what refuses a
 * discount larger than the subtotal, loudly, rather than flooring it. Applied only while the invoice
 * is a `draft`: once `issued` the total is the number the merchant has been told they owe, and
 * `CollectInvoice`'s `<invoiceId>:<version>:collect` key is derived from a `version` that any later
 * mutation would bump — silently minting a new key.
 */
describe("Invoice discount (T14.3)", () => {
  const usd = (amountMinor: number) => {
    const money = Money.create(amountMinor, "USD");
    if (!money.ok) throw new Error("bad money");
    return money.value;
  };
  const plan = () => draft([{ description: "plan", amountMinor: 2900 }]);

  it("reduces the total by the discount and leaves the subtotal and the lines untouched", () => {
    const invoice = plan();
    invoice.applyDiscount("coupon-1", usd(500), "e2", NOW);
    expect(invoice.subtotal.amountMinor).toBe(2900);
    expect(invoice.totalMinor).toBe(2400);
    expect(invoice.lineItems).toEqual([{ description: "plan", amountMinor: 2900 }]);
    expect(invoice.discount).toEqual({ couponRef: "coupon-1", amountMinor: 500 });
    expect(invoice.isFullyDiscounted).toBe(false);
  });

  it("a discount equal to the subtotal makes the invoice fully discounted (total 0)", () => {
    const invoice = plan();
    invoice.applyDiscount("coupon-1", usd(2900), "e2", NOW);
    expect(invoice.totalMinor).toBe(0);
    expect(invoice.isFullyDiscounted).toBe(true);
  });

  it("an invoice that was never discounted is not `fully discounted`, even at zero", () => {
    expect(draft([{ description: "free", amountMinor: 0 }]).isFullyDiscounted).toBe(false);
  });

  it("refuses a discount larger than the subtotal via Money's non-negativity, changing nothing", () => {
    const invoice = plan();
    expect(() => invoice.applyDiscount("coupon-1", usd(2901), "e2", NOW)).toThrow(/negative/i);
    expect(invoice.discount).toBeUndefined();
    expect(invoice.totalMinor).toBe(2900);
  });

  it("refuses a discount in another currency", () => {
    const egp = Money.create(500, "EGP");
    if (!egp.ok) throw new Error("bad money");
    const invoice = plan();
    expect(() => invoice.applyDiscount("coupon-1", egp.value, "e2", NOW)).toThrow(/different/i);
    expect(invoice.discount).toBeUndefined();
  });

  it("allows ONE discount per invoice", () => {
    const invoice = plan();
    invoice.applyDiscount("coupon-1", usd(500), "e2", NOW);
    expect(() => invoice.applyDiscount("coupon-2", usd(100), "e3", NOW)).toThrow(/already/i);
    expect(invoice.discount?.couponRef).toBe("coupon-1");
    expect(invoice.totalMinor).toBe(2400);
  });

  it("is applicable only to a DRAFT invoice — the machine refuses every other status", () => {
    const issued = plan();
    issued.issue("e2", NOW);
    const paid = plan();
    paid.issue("e2", NOW);
    paid.markPaid("ref", "e3", NOW);
    const failed = plan();
    failed.issue("e2", NOW);
    failed.markFailed("e3", NOW);
    const voided = plan();
    voided.voidInvoice("e2", NOW);
    for (const invoice of [issued, paid, failed, voided]) {
      const before = invoice.totalMinor;
      expect(() => invoice.applyDiscount("coupon-1", usd(500), "e9", NOW)).toThrow(/draft/i);
      expect(invoice.discount).toBeUndefined();
      expect(invoice.totalMinor).toBe(before);
    }
  });

  it("survives reconstitution and re-issue: a failed, discounted invoice retries at the discounted total", () => {
    const invoice = plan();
    invoice.applyDiscount("coupon-1", usd(500), "e2", NOW);
    invoice.issue("e3", NOW);
    invoice.markFailed("e4", NOW);
    const reloaded = Invoice.reconstitute(
      ID,
      "merchant-1",
      "sub-1",
      "USD",
      invoice.lineItems,
      "failed",
      3,
      undefined,
      invoice.discount,
    );
    reloaded.issue("e5", NOW);
    expect(reloaded.totalMinor).toBe(2400);
  });

  it("raises licensing.invoice.discounted", () => {
    const invoice = plan();
    invoice.applyDiscount("coupon-1", usd(500), "e2", NOW);
    const actions = invoice.domainEvents.map(
      (e) => (e as unknown as { data: { action: string } }).data.action,
    );
    expect(actions).toContain("discounted");
  });
});
