import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHECKOUT_SETTINGS,
  effectiveCheckoutSettings,
  toPublicCheckoutSettings,
  validateCheckoutSettings,
  type CheckoutSettingsValues,
} from "./checkout-settings";

const valid: CheckoutSettingsValues = {
  nameMode: "optional",
  phoneMode: "optional",
  line2Mode: "required",
  marketingEmailPrompt: "show",
  cartLineLimit: 5,
  requireLogin: true,
  accountsMode: "optional",
  showAccountLink: false,
};

function fieldsOf(result: ReturnType<typeof validateCheckoutSettings>): string[] {
  if (result.ok) throw new Error("expected err");
  return (result.error.fields ?? []).map((issue: { field: string }) => issue.field).sort();
}

describe("DEFAULT_CHECKOUT_SETTINGS (D33)", () => {
  it("is today's behaviour: name+phone required, line 2 optional, nothing else switched on", () => {
    expect(DEFAULT_CHECKOUT_SETTINGS).toEqual({
      nameMode: "required",
      phoneMode: "required",
      line2Mode: "optional",
      marketingEmailPrompt: "hidden",
      cartLineLimit: null,
      requireLogin: false,
      accountsMode: "optional",
      showAccountLink: true,
    });
  });

  it("is itself a valid document", () => {
    expect(validateCheckoutSettings(DEFAULT_CHECKOUT_SETTINGS).ok).toBe(true);
  });

  it("is what a shop with no row gets", () => {
    expect(effectiveCheckoutSettings(null)).toBe(DEFAULT_CHECKOUT_SETTINGS);
  });
});

describe("validateCheckoutSettings", () => {
  it("accepts a full valid document unchanged", () => {
    const result = validateCheckoutSettings(valid);
    expect(result.ok && result.value).toEqual(valid);
  });

  it("accepts the limit bounds 1 and 999 and null", () => {
    for (const cartLineLimit of [1, 999, null]) {
      expect(validateCheckoutSettings({ ...valid, cartLineLimit }).ok).toBe(true);
    }
  });

  it.each([0, 1000, -3, 2.5, "5", Number.NaN])("refuses cartLineLimit %s", (cartLineLimit) => {
    expect(fieldsOf(validateCheckoutSettings({ ...valid, cartLineLimit }))).toEqual([
      "cartLineLimit",
    ]);
  });

  it("names EVERY wrong field in one ValidationError", () => {
    const result = validateCheckoutSettings({
      nameMode: "hidden",
      phoneMode: "hidden",
      line2Mode: "x",
      marketingEmailPrompt: "always",
      cartLineLimit: 0,
      requireLogin: "yes",
      accountsMode: "off",
      showAccountLink: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    expect(fieldsOf(result)).toEqual([
      "accountsMode",
      "cartLineLimit",
      "line2Mode",
      "marketingEmailPrompt",
      "nameMode",
      "phoneMode",
      "requireLogin",
      "showAccountLink",
    ]);
  });

  it("D36: phone cannot be hidden", () => {
    expect(fieldsOf(validateCheckoutSettings({ ...valid, phoneMode: "hidden" }))).toEqual([
      "phoneMode",
    ]);
  });

  it("D37: requireLogin while accounts are disabled is refused with a readable message", () => {
    const result = validateCheckoutSettings({
      ...valid,
      requireLogin: true,
      accountsMode: "disabled",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.fields).toEqual([
      { field: "requireLogin", message: "Customer accounts must be on to require login" },
    ]);
  });

  it("accepts accounts disabled when login is not required", () => {
    expect(
      validateCheckoutSettings({ ...valid, requireLogin: false, accountsMode: "disabled" }).ok,
    ).toBe(true);
  });

  it("refuses a missing document", () => {
    expect(validateCheckoutSettings(undefined).ok).toBe(false);
    expect(validateCheckoutSettings(null).ok).toBe(false);
  });
});

describe("toPublicCheckoutSettings", () => {
  it("returns exactly the eight storefront fields", () => {
    expect(Object.keys(toPublicCheckoutSettings(valid)).sort()).toEqual([
      "accountsMode",
      "cartLineLimit",
      "line2Mode",
      "marketingEmailPrompt",
      "nameMode",
      "phoneMode",
      "requireLogin",
      "showAccountLink",
    ]);
  });
});
