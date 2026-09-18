import { UniqueEntityId } from "@platform/domain";
import { describe, expect, it } from "vitest";
import type { FeatureFlag } from "../domain/feature-flag";
import { FeatureFlag as FeatureFlagAggregate } from "../domain/feature-flag";
import type { FeatureFlagRepository } from "../domain/feature-flag-repository";
import { AggregateFeatureFlags } from "./aggregate-feature-flags";

function flagWithRollout(key: string, percentage: number): FeatureFlag {
  const flag = FeatureFlagAggregate.create(UniqueEntityId.from(`flag-${key}`), key, key);
  flag.setRolloutPercentage(percentage, "test-setup", "evt-1", new Date("2026-01-01"));
  return flag;
}

/** Keyed by tenantId, matching the invariant `InMemoryFeatureFlagRepository` already enforces. */
class FakeFeatureFlagRepository implements FeatureFlagRepository {
  constructor(private readonly byTenant: ReadonlyMap<string, FeatureFlag>) {}

  async findByKey(key: string, tenantId: string): Promise<FeatureFlag | null> {
    const flag = this.byTenant.get(tenantId);
    return flag !== undefined && flag.key === key ? flag : null;
  }

  async findById(): Promise<FeatureFlag | null> {
    throw new Error("not used by this test");
  }

  async list(): ReturnType<FeatureFlagRepository["list"]> {
    throw new Error("not used by this test");
  }

  async save(): Promise<void> {
    throw new Error("not used by this test");
  }
}

describe("AggregateFeatureFlags", () => {
  it("evaluates the same flag key per-tenant: tenant A's rollout does not leak into tenant B's", async () => {
    const repo = new FakeFeatureFlagRepository(
      new Map([
        ["tenant-a", flagWithRollout("checkout.express", 100)],
        ["tenant-b", flagWithRollout("checkout.express", 0)],
      ]),
    );
    const evaluator = new AggregateFeatureFlags({ flags: repo });

    await expect(
      evaluator.isEnabled("checkout.express", "tenant-a", { subjectId: "customer-1" }),
    ).resolves.toBe(true);
    await expect(
      evaluator.isEnabled("checkout.express", "tenant-b", { subjectId: "customer-1" }),
    ).resolves.toBe(false);
  });

  it("evaluates to disabled, not an error, when the flag does not exist for that tenant", async () => {
    const repo = new FakeFeatureFlagRepository(
      new Map([["tenant-a", flagWithRollout("checkout.express", 100)]]),
    );
    const evaluator = new AggregateFeatureFlags({ flags: repo });

    await expect(
      evaluator.isEnabled("checkout.express", "tenant-b", { subjectId: "customer-1" }),
    ).resolves.toBe(false);
  });

  it("fails closed on a missing tenant rather than defaulting", async () => {
    const repo = new FakeFeatureFlagRepository(new Map());
    const evaluator = new AggregateFeatureFlags({ flags: repo });

    await expect(
      evaluator.isEnabled("checkout.express", "", { subjectId: "customer-1" }),
    ).rejects.toThrow(/tenantId is required/);
  });
});
