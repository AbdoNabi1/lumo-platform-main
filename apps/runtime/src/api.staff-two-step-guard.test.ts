import { describe, expect, it } from "vitest";
import { assertProductionStaffTwoStepConfigured } from "./api";

const required = { staffTwoStep: "required", authMode: "native", mfaConfigured: false } as const;

describe("assertProductionStaffTwoStepConfigured (Wave 1f, D31)", () => {
  it("production + required + native + no key/provider: refuses to boot with the clear error", () => {
    expect(() => assertProductionStaffTwoStepConfigured("production", required)).toThrow(
      /STAFF_TWO_STEP=required needs MFA_TOTP_KEY and the TOTP provider/,
    );
    expect(() => assertProductionStaffTwoStepConfigured("staging", required)).toThrow(
      /MFA_TOTP_KEY/,
    );
  });

  it("production + required + the code step available: boots", () => {
    expect(() =>
      assertProductionStaffTwoStepConfigured("production", { ...required, mfaConfigured: true }),
    ).not.toThrow();
  });

  it("optional boots without a key, anywhere", () => {
    expect(() =>
      assertProductionStaffTwoStepConfigured("production", {
        ...required,
        staffTwoStep: "optional",
      }),
    ).not.toThrow();
  });

  it("local boots without a key (a warning, never an error)", () => {
    expect(() => assertProductionStaffTwoStepConfigured("local", required)).not.toThrow();
  });

  it("AUTH_MODE=ory: staff sign in through Ory, so the rule has nothing to guard (boots)", () => {
    expect(() =>
      assertProductionStaffTwoStepConfigured("production", { ...required, authMode: "ory" }),
    ).not.toThrow();
  });
});
