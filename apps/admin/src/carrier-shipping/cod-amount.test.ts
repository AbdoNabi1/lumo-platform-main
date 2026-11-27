import { beforeEach, describe, expect, it } from "vitest";
import { decideCodAmount } from "./cod-amount";

beforeEach(() => {
  expect.hasAssertions();
});

const order = (over: Record<string, unknown> = {}) => ({
  paymentStatus: "pending" as const,
  totalMinor: 25000,
  currency: "EGP",
  paymentRef: "pi-1",
  ...over,
});
const cod = (over: Record<string, unknown> = {}) => ({
  provider: "cod",
  status: "created",
  amountMinor: 25000,
  currency: "EGP",
  ...over,
});

describe("COD decision", () => {
  it("a paid order ships with COD 0", () =>
    expect(decideCodAmount(order({ paymentStatus: "paid" }), null)).toEqual({
      ok: true,
      codAmountMinor: 0,
    }));
  it("an open COD intent equal to the total is the COD amount", () =>
    expect(decideCodAmount(order(), cod())).toEqual({ ok: true, codAmountMinor: 25000 }));
  it("a pending card order is ORDER_NOT_PAID, never COD 0 (Review Focus 1)", () => {
    expect(decideCodAmount(order(), cod({ provider: "paymob" }))).toEqual({
      ok: false,
      code: "ORDER_NOT_PAID",
    });
    expect(decideCodAmount(order({ paymentRef: undefined }), null)).toEqual({
      ok: false,
      code: "ORDER_NOT_PAID",
    });
    expect(decideCodAmount(order(), cod({ status: "failed" }))).toEqual({
      ok: false,
      code: "ORDER_NOT_PAID",
    });
  });
  it("a COD intent that differs from the total is COD_AMOUNT_MISMATCH", () =>
    expect(decideCodAmount(order(), cod({ amountMinor: 24000 }))).toEqual({
      ok: false,
      code: "COD_AMOUNT_MISMATCH",
    }));
  it("a different intent currency is COD_AMOUNT_MISMATCH", () =>
    expect(decideCodAmount(order(), cod({ currency: "USD" }))).toEqual({
      ok: false,
      code: "COD_AMOUNT_MISMATCH",
    }));
  it("refunded or voided is ORDER_NOT_SHIPPABLE", () => {
    expect(decideCodAmount(order({ paymentStatus: "refunded" }), cod())).toEqual({
      ok: false,
      code: "ORDER_NOT_SHIPPABLE",
    });
    expect(decideCodAmount(order({ paymentStatus: "voided" }), cod())).toEqual({
      ok: false,
      code: "ORDER_NOT_SHIPPABLE",
    });
  });
});
