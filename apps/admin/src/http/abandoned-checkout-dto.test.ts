import { describe, expect, it } from "vitest";
import { checkoutReference, recoveredOrderOf } from "./abandoned-checkout-dto";

describe("abandoned checkout DTO helpers (spec §3.6)", () => {
  it("the reference is # and the id's last 8 hex digits, upper case", () => {
    expect(checkoutReference("01920000-0000-7000-8000-00000000abcd")).toBe("#0000ABCD");
  });

  it("a recovered checkout names its order, with the number when it could be read", () => {
    expect(
      recoveredOrderOf({ recoveredOrderRef: "order-9" }, new Map([["order-9", "1007"]])),
    ).toEqual({
      id: "order-9",
      orderNumber: "1007",
    });
    expect(recoveredOrderOf({ recoveredOrderRef: "order-9" }, new Map())).toEqual({
      id: "order-9",
      orderNumber: null,
    });
    expect(recoveredOrderOf({ recoveredOrderRef: undefined }, new Map())).toBeNull();
  });
});
