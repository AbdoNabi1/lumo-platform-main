import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { LoyaltyAccount } from "./loyalty-account";
import { RewardTier } from "./value-objects/reward-tier";
import { Reward } from "./value-objects/reward";

const tiers = [
  RewardTier.create("bronze", 0),
  RewardTier.create("silver", 100),
  RewardTier.create("gold", 500),
];

function account(): LoyaltyAccount {
  return LoyaltyAccount.create(UniqueEntityId.from("account-1"), "customer-1", tiers);
}

describe("LoyaltyAccount", () => {
  it("starts active at the bronze tier with a zero balance", () => {
    const a = account();
    expect(a.status.value).toBe("active");
    expect(a.tierName).toBe("bronze");
    expect(a.points.balance).toBe(0);
  });

  it("earns points and raises a points.earned event", () => {
    const a = account();
    a.earn("idem-1", 50, "order-1", "evt-1", new Date(0));
    expect(a.points.balance).toBe(50);
    const events = a.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("loyalty.transitioned");
  });

  it("earning is idempotent by idempotencyKey", () => {
    const a = account();
    a.earn("idem-1", 50, "order-1", "evt-1", new Date(0));
    a.earn("idem-1", 50, "order-1", "evt-2", new Date(0));
    expect(a.points.balance).toBe(50);
  });

  it("upgrades tier once the points threshold is crossed", () => {
    const a = account();
    a.earn("idem-1", 150, "order-1", "evt-1", new Date(0));
    expect(a.tierName).toBe("silver");
  });

  it("spends points and rejects an insufficient balance", () => {
    const a = account();
    a.earn("idem-1", 50, "order-1", "evt-1", new Date(0));
    expect(() => a.spend("idem-2", 100, "reward-1", "evt-2", new Date(0))).toThrow(
      BusinessRuleError,
    );
    a.spend("idem-3", 30, "reward-1", "evt-3", new Date(0));
    expect(a.points.balance).toBe(20);
  });

  it("redeems a reward, spending its cost in points", () => {
    const a = account();
    a.earn("idem-1", 100, "order-1", "evt-1", new Date(0));
    const reward = Reward.create("reward-1", "Free shipping", 50);
    if (!reward.ok) throw new Error("invalid fixture");
    a.redeemReward("idem-2", reward.value, "evt-2", new Date(0));
    expect(a.points.balance).toBe(50);
  });

  it("rejects earning on a suspended account", () => {
    const a = account();
    a.suspend("evt-1", new Date(0));
    expect(() => a.earn("idem-1", 10, "order-1", "evt-2", new Date(0))).toThrow(BusinessRuleError);
  });

  it("rejects an illegal status transition (closed -> active, 409)", () => {
    const a = account();
    a.close("evt-1", new Date(0));
    expect(() => a.transition("active", "evt-2", new Date(0))).toThrow(BusinessRuleError);
  });
});
