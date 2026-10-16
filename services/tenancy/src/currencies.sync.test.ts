import { describe, expect, it } from "vitest";
import { CURRENCY_CODES as REGION_CURRENCIES } from "@platform/regions";
import { CURRENCY_CODES } from "./domain/currencies";

/**
 * The Tenancy domain embeds the ISO 4217 list (it may not import `@platform/regions`), and the admin
 * app's currency select reads the shared one. They must never drift: a code the select offers but the
 * domain refuses would be an error the merchant cannot fix.
 */
describe("store currency list", () => {
  it("is identical to the shared one in @platform/regions", () => {
    expect([...CURRENCY_CODES]).toEqual([...REGION_CURRENCIES]);
  });
});
