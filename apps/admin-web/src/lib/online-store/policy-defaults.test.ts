import { describe, expect, it } from "vitest";
import { policyTemplateDefaults } from "./policy-defaults";

describe("policyTemplateDefaults (Ruling 20)", () => {
  it("prefills the store name and, for an admin, the contact email; the rest are the spec's defaults", () => {
    expect(
      policyTemplateDefaults({ storeName: "Nour" }, { contactEmail: "hi@nour.example" }),
    ).toEqual({
      storeName: "Nour",
      contactEmail: "hi@nour.example",
      contactPhone: "",
      businessAddress: "",
      returnWindowDays: 14,
      returnShippingPaidBy: "customer",
      refundMethod: "original",
      cashOnDelivery: true,
      deliveryDays: { min: 2, max: 5 },
      shipsInternationally: false,
    });
  });
  it("leaves both blank when the reads failed (an operator cannot read store settings)", () => {
    const d = policyTemplateDefaults(null, null);
    expect(d.storeName).toBe("");
    expect(d.contactEmail).toBe("");
    expect(policyTemplateDefaults({ storeName: "Nour" }, { contactEmail: null }).contactEmail).toBe(
      "",
    );
  });
});
