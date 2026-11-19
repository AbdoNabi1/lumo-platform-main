import { describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { policyTemplateDefaults } from "./policy-defaults";
import {
  TEMPLATE_TEXT_MAX,
  templateErrorState,
  templateInputIssues,
} from "./policy-template-inputs";

const valid = policyTemplateDefaults({ storeName: "Nour" }, { contactEmail: "hi@nour.example" });

describe("templateInputIssues (the API's own template input rules, I-2 / M-5)", () => {
  it("accepts the defaults and the API's limits exactly", () => {
    expect(TEMPLATE_TEXT_MAX).toEqual({
      storeName: 120,
      contactEmail: 254,
      contactPhone: 30,
      businessAddress: 500,
    });
    expect(templateInputIssues(valid)).toEqual([]);
    expect(templateInputIssues({ ...valid, contactPhone: `  ${"1".repeat(30)}  ` })).toEqual([]);
  });
  it("names each refused input by its API path and code", () => {
    expect(
      templateInputIssues({
        ...valid,
        storeName: "n".repeat(121),
        contactPhone: 30,
        returnWindowDays: 366,
        refundMethod: "bank",
        cashOnDelivery: "yes",
        deliveryDays: { min: 5, max: 2 },
      }),
    ).toEqual([
      { field: "storeName", code: "TOO_LONG" },
      { field: "contactPhone", code: "INVALID_VALUE" },
      { field: "returnWindowDays", code: "OUT_OF_RANGE" },
      { field: "refundMethod", code: "INVALID_VALUE" },
      { field: "cashOnDelivery", code: "INVALID_VALUE" },
      { field: "deliveryDays.max", code: "OUT_OF_RANGE" },
    ]);
    expect(templateInputIssues({ ...valid, returnWindowDays: "14" })).toEqual([
      { field: "returnWindowDays", code: "INVALID_VALUE" },
    ]);
    expect(templateInputIssues({ ...valid, extra: 1 })).toEqual([
      { field: "extra", code: "UNKNOWN_KEY" },
    ]);
    expect(templateInputIssues(null)).toEqual([{ field: "inputs", code: "INVALID_VALUE" }]);
  });
});

describe("templateErrorState (a refusal names the right field)", () => {
  it("a text input that is too long says so on that input, never the day-count copy", () => {
    expect(templateErrorState([{ field: "inputs.contactPhone", code: "TOO_LONG" }], en)).toEqual({
      message: en.formErrors.invalid,
      fieldErrors: { contactPhone: en.onlineStorePreferences.tooLong },
    });
  });
  it("day counts keep their own copy, in the admin's language", () => {
    expect(
      templateErrorState(
        [
          { field: "inputs.returnWindowDays", code: "OUT_OF_RANGE" },
          { field: "inputs.deliveryDays.max", code: "OUT_OF_RANGE" },
        ],
        ar,
      ),
    ).toEqual({
      message: ar.policies.templateInvalid,
      fieldErrors: {
        returnWindowDays: ar.policies.templateInvalid,
        "deliveryDays.max": ar.policies.templateInvalid,
      },
    });
  });
  it("anything else is the generic copy", () => {
    expect(
      templateErrorState([{ field: "inputs.refundMethod", code: "INVALID_VALUE" }], en),
    ).toEqual({ message: en.formErrors.invalid, fieldErrors: {} });
  });
});
