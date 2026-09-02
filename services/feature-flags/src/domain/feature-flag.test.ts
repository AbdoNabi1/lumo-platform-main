import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { FeatureFlag } from "./feature-flag";
import { FeatureEnvironment } from "./value-objects/feature-environment";
import { FeatureRule } from "./value-objects/feature-rule";

function flag(): FeatureFlag {
  return FeatureFlag.create(UniqueEntityId.from("flag-1"), "new-checkout", "New checkout flow");
}

describe("FeatureFlag", () => {
  it("starts active with a 0% rollout (disabled for everyone)", () => {
    const f = flag();
    expect(f.status.value).toBe("active");
    expect(f.evaluate("customer-1").enabled).toBe(false);
  });

  it("evaluates deterministically at 100% rollout", () => {
    const f = flag();
    f.setRolloutPercentage(100, "admin-1", "evt-1", new Date(0));
    expect(f.evaluate("customer-1").enabled).toBe(true);
    expect(f.evaluate("customer-1").reason).toBe("rollout_bucket");
  });

  it("a matching rule takes priority over rollout percentage", () => {
    const f = flag();
    const rule = FeatureRule.create("user", ["customer-1"], true);
    f.addRule(rule, "admin-1", "evt-1", new Date(0));
    expect(f.evaluate("customer-1").enabled).toBe(true);
    expect(f.evaluate("customer-1").reason).toBe("rule_match");
    expect(f.evaluate("customer-2").enabled).toBe(false);
  });

  it("a kill switch disables the flag regardless of rollout", () => {
    const f = flag();
    f.setRolloutPercentage(100, "admin-1", "evt-1", new Date(0));
    f.kill("admin-1", "evt-2", new Date(0));
    expect(f.evaluate("customer-1").enabled).toBe(false);
    expect(f.evaluate("customer-1").reason).toBe("killed");
  });

  it("revives from killed back to active", () => {
    const f = flag();
    f.kill("admin-1", "evt-1", new Date(0));
    f.revive("admin-1", "evt-2", new Date(0));
    expect(f.status.value).toBe("active");
  });

  it("respects an environment override", () => {
    const f = flag();
    f.setEnvironmentOverride(
      FeatureEnvironment.create("staging", true),
      "admin-1",
      "evt-1",
      new Date(0),
    );
    expect(f.evaluate("customer-1", "staging").enabled).toBe(true);
    expect(f.evaluate("customer-1", "production").enabled).toBe(false);
  });

  it("records every config change to the append-only audit log", () => {
    const f = flag();
    f.setRolloutPercentage(50, "admin-1", "evt-1", new Date(0));
    expect(f.changes).toHaveLength(1);
    expect(f.changes[0]?.action).toBe("rollout_changed");
  });

  it("rejects an illegal transition (archived -> active, 409)", () => {
    const f = flag();
    f.archive("admin-1", "evt-1", new Date(0));
    expect(() => f.transition("active", "admin-1", "evt-2", new Date(0))).toThrow(
      BusinessRuleError,
    );
  });
});
