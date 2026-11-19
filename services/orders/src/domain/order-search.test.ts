import { describe, expect, it } from "vitest";
import { matchesOrderSearch, phoneSearchNeedles, type SearchableOrder } from "./order-search";

describe("phoneSearchNeedles", () => {
  it("is just the text for a name", () => {
    expect(phoneSearchNeedles("Mona")).toEqual(["Mona"]);
  });

  it("adds the bare digits and the national form without the leading 0", () => {
    expect(phoneSearchNeedles("01012345678")).toEqual(["01012345678", "1012345678"]);
  });

  it("ignores spaces, dashes and brackets the merchant typed", () => {
    expect(phoneSearchNeedles(" 010 1234-5678 ")).toEqual([
      "010 1234-5678",
      "01012345678",
      "1012345678",
    ]);
  });

  it("drops the plus of an international number so +20 … finds +201…", () => {
    expect(phoneSearchNeedles("+20 101 234 5678")).toEqual(["+20 101 234 5678", "201012345678"]);
  });

  it("adds nothing for fewer than four digits", () => {
    expect(phoneSearchNeedles("123")).toEqual(["123"]);
  });
});

function order(overrides: Partial<SearchableOrder["shippingAddress"]> = {}): SearchableOrder {
  return {
    orderNumber: { value: "1001" },
    customerRef: "customer-abc",
    shippingAddress: { recipientName: "Mona Ali", phone: "+201012345678", ...overrides },
  };
}

describe("matchesOrderSearch", () => {
  it("matches the order number, the customer ref and the recipient (case-insensitive)", () => {
    expect(matchesOrderSearch(order(), "1001")).toBe(true);
    expect(matchesOrderSearch(order(), "ABC")).toBe(true);
    expect(matchesOrderSearch(order(), "mona")).toBe(true);
  });

  it("matches the phone typed the Egyptian way", () => {
    expect(matchesOrderSearch(order(), "010 1234 5678")).toBe(true);
    expect(matchesOrderSearch(order(), "01012345678")).toBe(true);
  });

  it("does not match anything else, and an order with no phone never matches by phone", () => {
    expect(matchesOrderSearch(order(), "Ahmed")).toBe(false);
    expect(matchesOrderSearch(order({ phone: undefined }), "01012345678")).toBe(false);
  });

  it("a blank search matches everything", () => {
    expect(matchesOrderSearch(order(), "   ")).toBe(true);
  });
});
