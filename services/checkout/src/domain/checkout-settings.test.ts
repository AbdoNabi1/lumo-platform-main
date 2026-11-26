import { describe, expect, it } from "vitest";
import {
  addressRuleIssues,
  addressRulesFor,
  cartLineLimitIssue,
  DEFAULT_CHECKOUT_SETTINGS,
  effectiveCheckoutSettings,
  normalizeAddressInput,
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

describe("address rules", () => {
  it("a shop with no row keeps today's server rules (nothing required, nothing dropped)", () => {
    const rules = addressRulesFor(null);
    expect(addressRuleIssues(rules, {})).toEqual([]);
    const input = { name: "", phone: "", line2: "Flat 2" };
    expect(normalizeAddressInput(rules, input)).toEqual(input);
  });

  it("saved defaults require name and phone and leave line 2 optional", () => {
    const rules = addressRulesFor({ values: DEFAULT_CHECKOUT_SETTINGS, version: 1 });
    expect(addressRuleIssues(rules, {}).map((i) => i.field)).toEqual(["name", "phone"]);
    expect(addressRuleIssues(rules, { name: "  ", phone: " " }).map((i) => i.field)).toEqual([
      "name",
      "phone",
    ]);
    expect(addressRuleIssues(rules, { name: "Mona", phone: "0100" })).toEqual([]);
  });

  it("optional name/phone are not required and blanks become absent", () => {
    const rules = addressRulesFor({
      values: { ...DEFAULT_CHECKOUT_SETTINGS, nameMode: "optional", phoneMode: "optional" },
      version: 2,
    });
    expect(addressRuleIssues(rules, {})).toEqual([]);
    expect(normalizeAddressInput(rules, { name: " ", phone: "", line2: "" })).toEqual({
      name: undefined,
      phone: undefined,
      line2: undefined,
    });
  });

  it("line2 required and empty is refused; filled is fine", () => {
    const rules = addressRulesFor({
      values: {
        ...DEFAULT_CHECKOUT_SETTINGS,
        nameMode: "optional",
        phoneMode: "optional",
        line2Mode: "required",
      },
      version: 1,
    });
    expect(addressRuleIssues(rules, { line2: "" }).map((i) => i.field)).toEqual(["line2"]);
    expect(addressRuleIssues(rules, { line2: "Floor 3" })).toEqual([]);
  });

  it("line2 hidden drops anything sent", () => {
    const rules = addressRulesFor({
      values: { ...DEFAULT_CHECKOUT_SETTINGS, line2Mode: "hidden" },
      version: 1,
    });
    expect(normalizeAddressInput(rules, { name: "A", line2: "Flat 2" }).line2).toBeUndefined();
    expect(addressRuleIssues(rules, { name: "A", phone: "1", line2: "Flat 2" })).toEqual([]);
  });
});

describe("cartLineLimitIssue", () => {
  it("is null with no limit or when the quantity fits", () => {
    expect(cartLineLimitIssue(null, 500)).toBeNull();
    expect(cartLineLimitIssue(3, 3)).toBeNull();
  });
  it("names the quantity field and the limit when it does not", () => {
    expect(cartLineLimitIssue(3, 4)).toEqual({
      field: "quantity",
      message: "You can add up to 3 of this item",
    });
  });
});
