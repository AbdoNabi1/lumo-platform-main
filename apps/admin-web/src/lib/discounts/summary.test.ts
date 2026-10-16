import { describe, expect, it } from "vitest";
import type { DiscountDto } from "@/lib/api/discounts";
import { formatNumber } from "@/lib/format";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import {
  combinationsShort,
  discountSummary,
  listSummary,
  pluralCount,
  valueLine,
  type SummaryContext,
} from "./summary";

const ctx: SummaryContext = {
  t: en.discounts.summary,
  locale: "en",
  currency: "EGP",
  timeZone: "UTC",
};

const sale10: DiscountDto = {
  id: "promo-1",
  type: "amount_off_order",
  method: "code",
  title: "SALE10",
  code: "SALE10",
  status: "active",
  value: { kind: "percentage", amount: 10 },
  appliesTo: null,
  appliesOncePerOrder: false,
  buys: null,
  gets: null,
  maxUsesPerOrder: null,
  countries: null,
  maxShippingRateMinor: null,
  minimumRequirement: { kind: "amount", amountMinor: 20000 },
  customerEligibility: { kind: "all" },
  usageLimit: 100,
  oncePerCustomer: true,
  combinesWith: { product: true, order: false, shipping: true },
  startsAt: "2026-10-16T10:00:00.000Z",
  endsAt: "2026-10-31T10:00:00.000Z",
  usageCount: 1,
};

describe("listSummary", () => {
  it("reads like Shopify's list: value and minimum", () => {
    expect(listSummary(sale10, ctx)).toMatch(/^10% off entire order • Minimum purchase of .*200/);
  });

  it("leaves the minimum out when there is none", () => {
    expect(listSummary({ ...sale10, minimumRequirement: { kind: "none" } }, ctx)).toBe(
      "10% off entire order",
    );
  });
});

describe("valueLine", () => {
  it("covers every type", () => {
    expect(
      valueLine(
        { ...sale10, type: "amount_off_products", appliesTo: { kind: "categories", refs: ["c"] } },
        ctx,
      ),
    ).toBe("10% off selected categories");
    expect(
      valueLine(
        {
          ...sale10,
          type: "buy_x_get_y",
          value: null,
          buys: { kind: "quantity", value: 2, scope: "products", refs: ["p"] },
          gets: { quantity: 1, scope: "products", refs: ["p"], effect: { kind: "free" } },
        },
        ctx,
      ),
    ).toBe("Buy 2 items • Get 1 item free");
    expect(valueLine({ ...sale10, type: "free_shipping", value: null }, ctx)).toBe(
      "Free shipping to all countries",
    );
    expect(valueLine({ ...sale10, value: null }, ctx)).toBeNull();
  });
});

describe("discountSummary", () => {
  it("lists every detail in Shopify's order", () => {
    const lines = discountSummary(sale10, ctx);
    expect(lines[0]).toBe("10% off entire order");
    expect(lines).toContain("For all customers");
    expect(lines).toContain("Limit of 100 uses");
    expect(lines).toContain("One use per customer");
    expect(lines).toContain("Combines with product discounts and shipping discounts");
    expect(lines.at(-1)).toBe("Active from Oct 16, 2026 until Oct 31, 2026");
  });

  it("says when nothing combines and there is no minimum", () => {
    const lines = discountSummary(
      {
        ...sale10,
        minimumRequirement: { kind: "none" },
        combinesWith: { product: false, order: false, shipping: false },
        endsAt: null,
      },
      ctx,
    );
    expect(lines).toContain("No minimum purchase requirement");
    expect(lines).toContain("Can't combine with other discounts");
    expect(lines.at(-1)).toBe("Active from Oct 16, 2026");
  });

  it("skips the dates while the start is not a real date", () => {
    expect(
      discountSummary({ ...sale10, startsAt: "" }, ctx).some((l) => l.startsWith("Active")),
    ).toBe(false);
  });

  it("speaks Arabic", () => {
    const arabic: SummaryContext = { ...ctx, t: ar.discounts.summary, locale: "ar" };
    expect(discountSummary(sale10, arabic)[0]).toContain("على الطلب بالكامل");
  });
});

describe("pluralCount / combinationsShort", () => {
  it("picks the plural form for the locale", () => {
    expect(pluralCount(en.discounts.summary.items, 1, "en")).toBe("1 item");
    expect(pluralCount(en.discounts.summary.items, 3, "en")).toBe("3 items");
    expect(pluralCount(ar.discounts.summary.items, 2, "ar")).toBe("منتجين");
  });

  it("names the classes a discount combines with", () => {
    expect(combinationsShort({ product: true, order: false, shipping: true }, en.discounts)).toBe(
      "Product, Shipping",
    );
    expect(combinationsShort({ product: false, order: false, shipping: false }, en.discounts)).toBe(
      "Not combinable",
    );
  });
});

describe("usage limit and per-order plurals", () => {
  it("pluralises the English usage limit and per-order cap", () => {
    expect(discountSummary({ ...sale10, usageLimit: 1 }, ctx)).toContain("Limit of 1 use");
    expect(
      discountSummary(
        {
          ...sale10,
          type: "buy_x_get_y",
          value: null,
          buys: { kind: "quantity", value: 2, scope: "products", refs: ["p"] },
          gets: { quantity: 1, scope: "products", refs: ["p"], effect: { kind: "free" } },
          maxUsesPerOrder: 1,
        },
        ctx,
      ),
    ).toContain("Up to 1 use per order");
  });

  it("uses the Arabic plural form for each usage limit count", () => {
    const arabic: SummaryContext = { ...ctx, t: ar.discounts.summary, locale: "ar" };
    const limitLine = (usageLimit: number) =>
      discountSummary({ ...sale10, usageLimit }, arabic).find((line) => line.startsWith("حد أقصى"));
    expect(limitLine(1)).toBe("حد أقصى استخدام واحد");
    expect(limitLine(2)).toBe("حد أقصى استخدامان");
    expect(limitLine(5)).toBe(`حد أقصى ${formatNumber("ar", 5)} استخدامات`);
    expect(limitLine(11)).toBe(`حد أقصى ${formatNumber("ar", 11)} استخدامًا`);
  });
});
