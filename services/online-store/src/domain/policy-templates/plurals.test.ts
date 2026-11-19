import { describe, expect, it } from "vitest";
import { renderPolicyTemplate } from "./render";
import { DEFAULT_TEMPLATE_INPUTS } from "./template-inputs";
import { countPhrase, rangePhrase } from "./plurals";

describe("count phrases agree with the number", () => {
  it.each([
    [1, "1 day", "1 business day", "يوم واحد", "يوم عمل واحد"],
    [2, "2 days", "2 business days", "يومين", "يومي عمل"],
    [3, "3 days", "3 business days", "3 أيام", "3 أيام عمل"],
    [7, "7 days", "7 business days", "7 أيام", "7 أيام عمل"],
    [10, "10 days", "10 business days", "10 أيام", "10 أيام عمل"],
    [11, "11 days", "11 business days", "11 يوماً", "11 يوم عمل"],
    [14, "14 days", "14 business days", "14 يوماً", "14 يوم عمل"],
    [15, "15 days", "15 business days", "15 يوماً", "15 يوم عمل"],
    [100, "100 days", "100 business days", "100 يوم", "100 يوم عمل"],
    [101, "101 days", "101 business days", "101 يوم", "101 يوم عمل"],
  ])("%i", (n, enDays, enBusiness, arDays, arBusiness) => {
    expect(countPhrase("en", "day", n)).toBe(enDays);
    expect(countPhrase("en", "businessDay", n)).toBe(enBusiness);
    expect(countPhrase("ar", "day", n)).toBe(arDays);
    expect(countPhrase("ar", "businessDay", n)).toBe(arBusiness);
  });

  it("zero reads as a plural in English and a bare noun in Arabic", () => {
    expect(countPhrase("en", "day", 0)).toBe("0 days");
    expect(countPhrase("ar", "day", 0)).toBe("0 يوم");
  });

  it("a range is inflected by its last number", () => {
    expect(rangePhrase("en", 2, 5)).toBe("2 to 5 business days");
    expect(rangePhrase("ar", 2, 5)).toBe("2 إلى 5 أيام عمل");
    expect(rangePhrase("ar", 3, 12)).toBe("3 إلى 12 يوم عمل");
    expect(rangePhrase("en", 1, 1)).toBe("1 business day");
    expect(rangePhrase("ar", 2, 2)).toBe("يومي عمل");
  });

  it("the templates use the phrases", () => {
    const at = (n: number) => ({ ...DEFAULT_TEMPLATE_INPUTS, returnWindowDays: n });
    expect(renderPolicyTemplate("refund", "ar", at(7))).toContain("خلال 7 أيام من");
    expect(renderPolicyTemplate("refund", "ar", at(15))).toContain("خلال 15 يوماً من");
    expect(renderPolicyTemplate("refund", "en", at(1))).toContain("within 1 day of");
    expect(
      renderPolicyTemplate("shipping", "ar", {
        ...DEFAULT_TEMPLATE_INPUTS,
        deliveryDays: { min: 3, max: 15 },
      }),
    ).toContain("خلال 3 إلى 15 يوم عمل من");
  });
});
