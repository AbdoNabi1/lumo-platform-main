import { describe, expect, it } from "vitest";
import type { DiscountDto } from "@/lib/discounts/model";
import {
  apiFieldToFormField,
  emptyFormValues,
  formValuesFromDto,
  generateDiscountCode,
  parseFormValues,
  parsePercent,
  parsePositiveInt,
  toDiscountInput,
  type DiscountFormValues,
} from "./form";

const NOW = new Date("2026-10-16T10:30:00.000Z");
const ZONE = "UTC";

function values(overrides: Partial<DiscountFormValues> = {}): DiscountFormValues {
  return { ...emptyFormValues("amount_off_order", NOW, ZONE), ...overrides };
}

describe("parsePercent / parsePositiveInt", () => {
  it("accepts Arabic digits and up to two decimals", () => {
    expect(parsePercent("١٠")).toBe(10);
    expect(parsePercent("12.5")).toBe(12.5);
    expect(parsePercent("12.555")).toBeNull();
    expect(parsePercent("abc")).toBeNull();
    expect(parsePositiveInt("٣")).toBe(3);
    expect(parsePositiveInt("0")).toBeNull();
    expect(parsePositiveInt("2.5")).toBeNull();
  });
});

describe("emptyFormValues", () => {
  it("starts now, in the store's zone, as a code with nothing combined", () => {
    const empty = emptyFormValues("free_shipping", NOW, "Asia/Dubai");
    expect(empty.type).toBe("free_shipping");
    expect(empty.method).toBe("code");
    expect(empty.startDate).toBe("2026-10-16");
    expect(empty.startTime).toBe("14:30");
    expect(empty.hasEndDate).toBe(false);
    expect(empty.combinesWith).toEqual({ product: false, order: false, shipping: false });
  });
});

describe("toDiscountInput", () => {
  it("builds SALE10: 10% off the order over EGP 200", () => {
    const { input, fieldErrors } = toDiscountInput(
      values({
        code: " sale10 ",
        valueAmount: "10",
        minimumKind: "amount",
        minimumAmount: "200",
      }),
      "EGP",
      ZONE,
    );

    expect(fieldErrors).toEqual({});
    expect(input).toEqual({
      type: "amount_off_order",
      method: "code",
      code: "SALE10",
      value: { kind: "percentage", amount: 10 },
      minimumRequirement: { kind: "amount", amountMinor: 20000 },
      customerEligibility: { kind: "all" },
      oncePerCustomer: false,
      combinesWith: { product: false, order: false, shipping: false },
      startsAt: "2026-10-16T10:30:00.000Z",
    });
  });

  it("reports each missing or wrong field by its key", () => {
    const { fieldErrors } = toDiscountInput(
      values({
        code: "a!",
        valueAmount: "150",
        hasEndDate: true,
        endDate: "2026-10-15",
        endTime: "10:00",
      }),
      "EGP",
      ZONE,
    );
    expect(fieldErrors).toEqual({
      code: "codeFormat",
      value: "percentRange",
      endsAt: "endBeforeStart",
    });
    expect(toDiscountInput(values(), "EGP", ZONE).fieldErrors).toEqual({
      code: "required",
      value: "required",
    });
  });

  it("titles an automatic discount and drops the code-only limits", () => {
    const { input, fieldErrors } = toDiscountInput(
      values({
        method: "automatic",
        title: "  Summer  ",
        valueKind: "fixed_amount",
        valueAmount: "50",
        limitTotalUses: true,
        usageLimit: "10",
        oncePerCustomer: true,
      }),
      "EGP",
      ZONE,
    );
    expect(fieldErrors).toEqual({});
    expect(input.title).toBe("Summer");
    expect(input.code).toBeUndefined();
    expect(input.value).toEqual({ kind: "fixed_amount", amount: 5000 });
    expect(input.usageLimit).toBeUndefined();
    expect(input.oncePerCustomer).toBe(false);
  });

  it("needs picked items for amount off products, and sends once-per-order for a fixed amount", () => {
    const base = { ...emptyFormValues("amount_off_products", NOW, ZONE), code: "SHOES" };
    expect(toDiscountInput({ ...base, valueAmount: "10" }, "EGP", ZONE).fieldErrors).toEqual({
      appliesTo: "chooseItems",
    });

    const { input } = toDiscountInput(
      {
        ...base,
        valueKind: "fixed_amount",
        valueAmount: "25.50",
        appliesToKind: "categories",
        appliesToItems: [{ id: "cat-1", label: "Shoes" }],
        appliesOncePerOrder: true,
      },
      "EGP",
      ZONE,
    );
    expect(input.appliesTo).toEqual({ kind: "categories", refs: ["cat-1"] });
    expect(input.value).toEqual({ kind: "fixed_amount", amount: 2550 });
    expect(input.appliesOncePerOrder).toBe(true);
  });

  it("builds buy X get Y, without a minimum requirement", () => {
    const { input, fieldErrors } = toDiscountInput(
      {
        ...emptyFormValues("buy_x_get_y", NOW, ZONE),
        code: "B2G1",
        buysKind: "amount",
        buysValue: "300",
        buysItems: [{ id: "p-1", label: "Shirt" }],
        getsQuantity: "1",
        getsScope: "categories",
        getsItems: [{ id: "c-1", label: "Socks" }],
        getsEffect: "free",
        limitUsesPerOrder: true,
        maxUsesPerOrder: "2",
        minimumKind: "amount",
        minimumAmount: "999",
      },
      "EGP",
      ZONE,
    );
    expect(fieldErrors).toEqual({});
    expect(input.buys).toEqual({ kind: "amount", value: 30000, scope: "products", refs: ["p-1"] });
    expect(input.gets).toEqual({
      quantity: 1,
      scope: "categories",
      refs: ["c-1"],
      effect: { kind: "free" },
    });
    expect(input.maxUsesPerOrder).toBe(2);
    expect(input.minimumRequirement).toEqual({ kind: "none" });
  });

  it("reports buy X get Y's own fields", () => {
    const { fieldErrors } = toDiscountInput(
      { ...emptyFormValues("buy_x_get_y", NOW, ZONE), code: "B2G1", getsPercentage: "0" },
      "EGP",
      ZONE,
    );
    expect(fieldErrors).toEqual({
      buys: "required",
      buysItems: "chooseItems",
      gets: "required",
      getsItems: "chooseItems",
      getsEffect: "percentRange",
    });
  });

  it("builds free shipping to chosen countries under a rate cap", () => {
    const { input, fieldErrors } = toDiscountInput(
      {
        ...emptyFormValues("free_shipping", NOW, ZONE),
        code: "SHIPFREE",
        allCountries: false,
        countries: [{ id: "EG", label: "Egypt" }],
        excludeRatesOver: true,
        maxShippingRate: "75",
      },
      "EGP",
      ZONE,
    );
    expect(fieldErrors).toEqual({});
    expect(input.countries).toEqual(["EG"]);
    expect(input.maxShippingRateMinor).toBe(7500);
    expect(input.value).toBeUndefined();
  });

  it("limits a code to specific customers, total uses and one use each", () => {
    const { input } = toDiscountInput(
      values({
        code: "VIP",
        valueAmount: "5",
        allCustomers: false,
        customers: [{ id: "cus-1", label: "Mona" }],
        limitTotalUses: true,
        usageLimit: "100",
        oncePerCustomer: true,
        combinesWith: { product: true, order: false, shipping: true },
        hasEndDate: true,
        endDate: "2026-10-31",
        endTime: "23:59",
      }),
      "EGP",
      ZONE,
    );
    expect(input.customerEligibility).toEqual({ kind: "customers", customerRefs: ["cus-1"] });
    expect(input.usageLimit).toBe(100);
    expect(input.oncePerCustomer).toBe(true);
    expect(input.combinesWith).toEqual({ product: true, order: false, shipping: true });
    expect(input.endsAt).toBe("2026-10-31T23:59:00.000Z");
  });

  it("asks for customers when specific customers has none", () => {
    expect(
      toDiscountInput(values({ code: "VIP", valueAmount: "5", allCustomers: false }), "EGP", ZONE)
        .fieldErrors,
    ).toEqual({ customerEligibility: "chooseCustomers" });
  });
});

describe("formValuesFromDto", () => {
  it("is the inverse of toDiscountInput, with the picked items named", () => {
    const dto: DiscountDto = {
      id: "promo-1",
      type: "amount_off_products",
      method: "code",
      title: "SHOES",
      code: "SHOES",
      status: "active",
      value: { kind: "fixed_amount", amount: 2550 },
      appliesTo: { kind: "products", refs: ["p-1", "p-2"] },
      appliesOncePerOrder: true,
      buys: null,
      gets: null,
      maxUsesPerOrder: null,
      countries: null,
      maxShippingRateMinor: null,
      minimumRequirement: { kind: "quantity", quantity: 2 },
      customerEligibility: { kind: "customers", customerRefs: ["cus-1"] },
      usageLimit: 50,
      oncePerCustomer: true,
      combinesWith: { product: false, order: true, shipping: false },
      startsAt: "2026-10-16T10:30:00.000Z",
      endsAt: "2026-10-31T21:59:00.000Z",
      usageCount: 4,
    };

    const form = formValuesFromDto(
      dto,
      {
        products: { "p-1": "Sneaker" },
        categories: {},
        customers: { "cus-1": "Mona" },
        countries: {},
      },
      "EGP",
      ZONE,
    );

    expect(form.valueAmount).toBe("25.50");
    expect(form.appliesToItems).toEqual([
      { id: "p-1", label: "Sneaker" },
      { id: "p-2", label: "p-2" },
    ]);
    expect(form.minimumKind).toBe("quantity");
    expect(form.minimumQuantity).toBe("2");
    expect(form.customers).toEqual([{ id: "cus-1", label: "Mona" }]);
    expect(form.limitTotalUses).toBe(true);
    expect(form.usageLimit).toBe("50");
    expect(form.hasEndDate).toBe(true);
    expect(form.endDate).toBe("2026-10-31");
    expect(form.endTime).toBe("21:59");

    const { input, fieldErrors } = toDiscountInput(form, "EGP", ZONE);
    expect(fieldErrors).toEqual({});
    expect(input.value).toEqual(dto.value);
    expect(input.appliesTo).toEqual(dto.appliesTo);
    expect(input.startsAt).toBe(dto.startsAt);
    expect(input.endsAt).toBe(dto.endsAt);
  });
});

describe("parseFormValues", () => {
  it("accepts what the editor posts", () => {
    const posted = JSON.parse(JSON.stringify(values({ code: "X1Y" })));
    expect(parseFormValues(posted)).toEqual(values({ code: "X1Y" }));
  });

  it("rejects anything else", () => {
    expect(parseFormValues(null)).toBeNull();
    expect(parseFormValues("x")).toBeNull();
    expect(parseFormValues({ ...values(), type: "bogus" })).toBeNull();
    expect(parseFormValues({ ...values(), method: "magic" })).toBeNull();
  });

  it("drops malformed picked items instead of trusting them", () => {
    const parsed = parseFormValues({
      ...values(),
      customers: [{ id: "cus-1", label: "Mona" }, { id: 5 }, "x"],
    });
    expect(parsed?.customers).toEqual([{ id: "cus-1", label: "Mona" }]);
  });
});

describe("apiFieldToFormField", () => {
  it("maps the API's issue paths onto the form's fields", () => {
    expect(apiFieldToFormField("code")).toBe("code");
    expect(apiFieldToFormField("buys.refs")).toBe("buysItems");
    expect(apiFieldToFormField("gets.refs.0")).toBe("getsItems");
    expect(apiFieldToFormField("gets.effect.value")).toBe("gets");
    expect(apiFieldToFormField("customerEligibility.customerRefs")).toBe("customerEligibility");
  });
});

describe("generateDiscountCode", () => {
  it("makes a 12-character code the API accepts, different each time", () => {
    const first = generateDiscountCode();
    expect(first).toMatch(/^[A-Z0-9]{12}$/);
    expect(generateDiscountCode()).not.toBe(first);
  });
});
