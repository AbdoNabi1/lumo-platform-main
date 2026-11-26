import { describe, expect, it } from "vitest";
import {
  accountLinkVisible,
  DEFAULT_PUBLIC_CHECKOUT_SETTINGS,
  parsePublicCheckoutSettings,
} from "./checkout-settings-model";

const document = {
  nameMode: "optional",
  phoneMode: "optional",
  line2Mode: "required",
  marketingEmailPrompt: "preselect",
  cartLineLimit: 5,
  requireLogin: true,
  accountsMode: "optional",
  showAccountLink: false,
};

describe("the public checkout settings model", () => {
  it("the defaults are today's live behaviour (D33)", () => {
    expect(DEFAULT_PUBLIC_CHECKOUT_SETTINGS).toEqual({
      nameMode: "required",
      phoneMode: "required",
      line2Mode: "optional",
      marketingEmailPrompt: "hidden",
      cartLineLimit: null,
      requireLogin: false,
      accountsMode: "optional",
      showAccountLink: true,
    });
    expect(Object.isFrozen(DEFAULT_PUBLIC_CHECKOUT_SETTINGS)).toBe(true);
  });

  it("parses exactly the document the public route returns", () => {
    expect(parsePublicCheckoutSettings(document)).toEqual(document);
    expect(
      parsePublicCheckoutSettings({ ...document, cartLineLimit: null })?.cartLineLimit,
    ).toBeNull();
  });

  it("ignores a key it does not know, and refuses a partly understood document as a whole", () => {
    expect(parsePublicCheckoutSettings({ ...document, version: 3 })).toEqual(document);
    for (const bad of [
      null,
      "x",
      [],
      {},
      { ...document, nameMode: "hidden" },
      { ...document, phoneMode: "hidden" },
      { ...document, line2Mode: "maybe" },
      { ...document, marketingEmailPrompt: "yes" },
      { ...document, accountsMode: "off" },
      { ...document, cartLineLimit: 0 },
      { ...document, cartLineLimit: 1000 },
      { ...document, cartLineLimit: 2.5 },
      { ...document, cartLineLimit: "5" },
      { ...document, cartLineLimit: undefined },
      { ...document, requireLogin: "true" },
      { ...document, showAccountLink: 1 },
    ]) {
      expect(parsePublicCheckoutSettings(bad)).toBeNull();
    }
  });

  it("accepts the limit's edges, 1 and 999", () => {
    expect(parsePublicCheckoutSettings({ ...document, cartLineLimit: 1 })?.cartLineLimit).toBe(1);
    expect(parsePublicCheckoutSettings({ ...document, cartLineLimit: 999 })?.cartLineLimit).toBe(
      999,
    );
  });

  it("the account link shows only while the link is kept AND accounts are on", () => {
    const base = DEFAULT_PUBLIC_CHECKOUT_SETTINGS;
    expect(accountLinkVisible(base)).toBe(true);
    expect(accountLinkVisible({ ...base, showAccountLink: false })).toBe(false);
    expect(accountLinkVisible({ ...base, accountsMode: "disabled" })).toBe(false);
    expect(accountLinkVisible({ ...base, accountsMode: "disabled", showAccountLink: false })).toBe(
      false,
    );
  });
});
