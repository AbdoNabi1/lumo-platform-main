import { describe, expect, it } from "vitest";
import {
  isCollectedOnDelivery,
  isSettledByOperatorConfirmation,
  type ProviderCapabilities,
} from "./provider-capabilities";

const base: ProviderCapabilities = {
  settlesAtPayTime: true,
  deliversWebhooks: false,
  requiresMerchantCredentials: false,
  chargesOffSession: false,
};

describe("isCollectedOnDelivery (order operations Part 4, Ruling 9)", () => {
  it("is true for cash on delivery: settled by an operator's confirmation, not recorded by staff", () => {
    expect(isCollectedOnDelivery(base)).toBe(true);
    expect(isCollectedOnDelivery({ ...base, recordedByStaff: false })).toBe(true);
  });

  it("is false for a staff-recorded payment even though an operator's confirmation settles it", () => {
    const manual = { ...base, recordedByStaff: true };
    expect(isSettledByOperatorConfirmation(manual)).toBe(true);
    expect(isCollectedOnDelivery(manual)).toBe(false);
  });

  it("is false for a provider that is not settled by operator confirmation", () => {
    expect(
      isCollectedOnDelivery({ ...base, settlesAtPayTime: false, deliversWebhooks: true }),
    ).toBe(false);
    expect(isCollectedOnDelivery({ ...base, deliversWebhooks: true })).toBe(false);
  });
});
