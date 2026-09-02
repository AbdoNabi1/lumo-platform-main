import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Coupon } from "./coupon";
import { CouponCode } from "./value-objects/coupon-code";

function code(): CouponCode {
  const result = CouponCode.create("SAVE10");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function coupon(overrides: Partial<{ multiUse: boolean; usageLimit: number }> = {}): Coupon {
  return Coupon.create(
    UniqueEntityId.from("coupon-1"),
    code(),
    "promo-1",
    overrides.multiUse ?? true,
    overrides.usageLimit,
  );
}

describe("Coupon", () => {
  it("starts active", () => {
    const c = coupon();
    expect(c.status.value).toBe("active");
    expect(c.pullDomainEvents()).toHaveLength(0);
  });

  it("redeems and records an append-only redemption", () => {
    const c = coupon();
    c.redeem("idem-1", "customer-1", new Date(0), "evt-1");
    expect(c.redemptions).toHaveLength(1);
    expect(c.usageCount).toBe(1);
  });

  it("rejects a second single-use redemption by the same customer", () => {
    const c = coupon({ multiUse: false });
    c.redeem("idem-1", "customer-1", new Date(0), "evt-1");
    expect(() => c.redeem("idem-2", "customer-1", new Date(0), "evt-2")).toThrow(BusinessRuleError);
  });

  it("auto-transitions to depleted once the usage limit is reached", () => {
    const c = coupon({ usageLimit: 1 });
    c.redeem("idem-1", "customer-1", new Date(0), "evt-1");
    expect(c.status.value).toBe("depleted");
    const events = c.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("coupon.transitioned");
  });

  it("rejects redemption of a disabled coupon", () => {
    const c = coupon();
    c.disable("evt-1", new Date(0));
    expect(() => c.redeem("idem-1", "customer-1", new Date(0), "evt-2")).toThrow(BusinessRuleError);
  });

  it("rejects an illegal transition (expired -> active, 409)", () => {
    const c = coupon();
    c.expire("evt-1", new Date(0));
    expect(() => c.transition("active", "evt-2", new Date(0))).toThrow(BusinessRuleError);
  });
});
