import { describe, expect, it } from "vitest";
import type { PaymentProvider } from "@platform/contracts";
import type { ProviderRegistration } from "../application/provider-registry";
import { composePaymentProviderRegistrations } from "./built-in-provider-registrations";

const external = (recordedByStaff?: boolean): ProviderRegistration => ({
  key: "bank-transfer",
  capabilities: {
    settlesAtPayTime: true,
    deliversWebhooks: false,
    requiresMerchantCredentials: false,
    chargesOffSession: false,
    ...(recordedByStaff !== undefined ? { recordedByStaff } : {}),
  },
  backing: "real",
  create: () => ({}) as PaymentProvider,
});

describe("composePaymentProviderRegistrations", () => {
  it("composes the three built-ins, manual among them", () => {
    expect(composePaymentProviderRegistrations({}).map((r) => r.key)).toEqual([
      "stripe",
      "cod",
      "manual",
    ]);
  });

  it("refuses an externally registered provider that declares recordedByStaff — reserved for the built-in manual provider", () => {
    expect(() =>
      composePaymentProviderRegistrations({ providerRegistrations: [external(true)] }),
    ).toThrow(/recordedByStaff/);
  });

  it("accepts an external provider that does not declare it", () => {
    const keys = composePaymentProviderRegistrations({
      providerRegistrations: [external(), { ...external(false), key: "other" }],
    }).map((r) => r.key);
    expect(keys).toEqual(["stripe", "cod", "manual", "bank-transfer", "other"]);
  });
});
