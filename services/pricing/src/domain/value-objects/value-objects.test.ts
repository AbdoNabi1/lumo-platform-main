import { describe, expect, it } from "vitest";
import { Currency } from "./currency";

describe("Currency", () => {
  it("accepts ISO-4217 codes and rejects others", () => {
    expect(Currency.create("USD").ok).toBe(true);
    expect(Currency.create("us").ok).toBe(false);
    expect(Currency.create("usd").ok).toBe(false);
  });
});
