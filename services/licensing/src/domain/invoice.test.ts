import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
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

  it("refuses a negative amount (discounts are a separate, later concept — T14.3)", () => {
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
