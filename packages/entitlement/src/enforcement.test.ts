import { describe, expect, it, vi } from "vitest";
import type { Clock } from "@platform/contracts";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { EntitlementCache } from "./cache";
import {
  EntitlementGuard,
  InMemoryEntitlementAudit,
  InMemoryEntitlementPort,
  InMemoryPolicyPort,
  type EntitlementPort,
} from "./entitlement-guard";
import {
  ENFORCEMENT_TARGETS,
  ENTITLEMENT_POLICIES,
  POLICY_PIPELINE,
  policyPermits,
} from "./policy";
import { InMemoryUsageQuota, quotaBlocks } from "./quota";

const clock: Clock = { now: () => new Date("2026-07-14T00:00:00.000Z") };
const run = async (): Promise<Result<string, DomainError>> => ok("ran");

describe("Policy pipeline (P1.2 §2) — immutable", () => {
  it("declares the frozen evaluation order", () => {
    expect(POLICY_PIPELINE).toEqual([
      "platform_override",
      "merchant_override",
      "subscription",
      "feature_definition",
      "runtime_flag",
    ]);
    expect(Object.isFrozen(POLICY_PIPELINE)).toBe(true);
  });

  it("every policy has an explicit, total verdict for read and write (fail-closed by construction)", () => {
    for (const policy of ENTITLEMENT_POLICIES) {
      expect(typeof policyPermits(policy, "read")).toBe("boolean");
      expect(typeof policyPermits(policy, "write")).toBe("boolean");
    }
    expect(policyPermits("read_only", "read")).toBe(true);
    expect(policyPermits("read_only", "write")).toBe(false);
    for (const denied of ["deny", "expired", "suspended"] as const) {
      expect(policyPermits(denied, "read")).toBe(false);
      expect(policyPermits(denied, "write")).toBe(false);
    }
    for (const allowed of [
      "allow",
      "limited",
      "trial",
      "grace_period",
      "internal",
      "preview",
    ] as const) {
      expect(policyPermits(allowed, "write")).toBe(true);
    }
  });
});

describe("Runtime policies (P1.2 §4)", () => {
  function guardWith(policy: Parameters<InMemoryPolicyPort["set"]>[2]) {
    const port = new InMemoryEntitlementPort().set("t1", "f", true);
    return new EntitlementGuard(port, { policy: new InMemoryPolicyPort().set("t1", "f", policy) });
  }

  it("read_only permits reads and denies writes", async () => {
    const guard = guardWith("read_only");
    expect((await guard.evaluate({ tenant: "t1", featureKey: "f", action: "read" })).allowed).toBe(
      true,
    );
    const write = await guard.evaluate({ tenant: "t1", featureKey: "f", action: "write" });
    expect(write.allowed).toBe(false);
    expect(write.source).toBe("policy_denied");
    expect(write.policy).toBe("read_only");
  });

  it("suspended/expired deny; trial/grace/limited/preview/internal allow", async () => {
    for (const p of ["suspended", "expired"] as const)
      expect((await guardWith(p).evaluate({ tenant: "t1", featureKey: "f" })).allowed).toBe(false);
    for (const p of ["trial", "grace_period", "limited", "preview", "internal"] as const)
      expect((await guardWith(p).evaluate({ tenant: "t1", featureKey: "f" })).allowed).toBe(true);
  });

  it("defaults to write (fail-closed) when no action is declared", async () => {
    expect((await guardWith("read_only").evaluate({ tenant: "t1", featureKey: "f" })).allowed).toBe(
      false,
    );
  });
});

describe("Enforcement targets (P1.2 §3/§11/§12/§13)", () => {
  it("enforces every target through the one guard implementation", async () => {
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "f", true));
    for (const target of ENFORCEMENT_TARGETS) {
      const res = await guard.enforce(target, { tenant: "t1", featureKey: "f" }, run);
      expect(res.ok).toBe(true);
    }
  });

  it("AI requests and marketplace operations cannot bypass the guard", async () => {
    const guard = new EntitlementGuard(new InMemoryEntitlementPort()); // default deny
    const command = vi.fn(run);
    for (const target of ["ai_request", "marketplace_operation", "sdk", "cli"] as const) {
      const res = await guard.enforce(target, { tenant: "t1", featureKey: "ai.copy" }, command);
      expect(res.ok).toBe(false);
    }
    expect(command).not.toHaveBeenCalled();
  });
});

describe("Usage enforcement (P1.2 §5)", () => {
  const port = new InMemoryEntitlementPort().set("t1", "ai", true);

  it("allows under the limit and reports a warning near the threshold", async () => {
    const quota = new InMemoryUsageQuota()
      .setLimit("t1", "AI_TOKEN", { limit: 100 })
      .setUsed("t1", "AI_TOKEN", 79);
    const guard = new EntitlementGuard(port, { quota });
    const decision = await guard.evaluate({ tenant: "t1", featureKey: "ai", resource: "AI_TOKEN" });
    expect(decision.allowed).toBe(true);
    expect(decision.quota?.state).toBe("warning");
  });

  it("denies on hard limit exhaustion and on throttling", async () => {
    const quota = new InMemoryUsageQuota()
      .setLimit("t1", "AI_TOKEN", { limit: 10 })
      .setUsed("t1", "AI_TOKEN", 10);
    const hard = await new EntitlementGuard(port, { quota }).evaluate({
      tenant: "t1",
      featureKey: "ai",
      resource: "AI_TOKEN",
    });
    expect(hard.allowed).toBe(false);
    expect(hard.source).toBe("quota_exceeded");
    expect(hard.quota?.state).toBe("hard_exceeded");

    const throttling = new InMemoryUsageQuota().throttle("t1", "AI_TOKEN");
    const throttled = await new EntitlementGuard(port, { quota: throttling }).evaluate({
      tenant: "t1",
      featureKey: "ai",
      resource: "AI_TOKEN",
    });
    expect(throttled.allowed).toBe(false);
    expect(throttled.quota?.state).toBe("throttled");
  });

  it("soft limits do not block", async () => {
    const quota = new InMemoryUsageQuota()
      .setLimit("t1", "AI_TOKEN", { limit: 10, soft: true })
      .setUsed("t1", "AI_TOKEN", 50);
    const decision = await new EntitlementGuard(port, { quota }).evaluate({
      tenant: "t1",
      featureKey: "ai",
      resource: "AI_TOKEN",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.quota?.state).toBe("soft_exceeded");
    expect(quotaBlocks("soft_exceeded")).toBe(false);
  });

  it("unlimited (-1) never blocks", async () => {
    const quota = new InMemoryUsageQuota()
      .setLimit("t1", "AI_TOKEN", { limit: -1 })
      .setUsed("t1", "AI_TOKEN", 1e9);
    const decision = await new EntitlementGuard(port, { quota }).evaluate({
      tenant: "t1",
      featureKey: "ai",
      resource: "AI_TOKEN",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.quota?.state).toBe("ok");
  });
});

describe("Audit integration (P1.2 §7)", () => {
  it("records a denial and a grant on the immutable trail", async () => {
    const audit = new InMemoryEntitlementAudit();
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "ok", true), {
      audit,
      clock,
    });
    await guard.evaluate({
      tenant: "t1",
      featureKey: "ok",
      principalId: "u1",
      principalKind: "staff",
    });
    await guard.evaluate({ tenant: "t1", featureKey: "nope" });
    expect(audit.records.map((r) => r.decision)).toEqual(["allow", "deny"]);
    expect(audit.records[0]).toMatchObject({
      principalId: "u1",
      principalKind: "staff",
      permission: "entitlement:ok",
      tenantId: "t1",
    });
    expect(audit.records[1]?.metadata?.source).toBe("none");
  });

  it("downgrades a grant to a denial when it cannot be audited (fail-closed)", async () => {
    const audit = {
      record: async (): Promise<void> => {
        throw new Error("audit down");
      },
    };
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "f", true), {
      audit,
    });
    const decision = await guard.evaluate({ tenant: "t1", featureKey: "f" });
    expect(decision.allowed).toBe(false);
    expect(decision.source).toBe("audit_failure");
  });
});

describe("Runtime cache (P1.2 §8)", () => {
  it("memoizes a decision and invalidates by tenant and by feature", async () => {
    const port = new InMemoryEntitlementPort().set("t1", "f", true);
    const check = vi.spyOn(port, "check");
    const cache = new EntitlementCache({ clock });
    const guard = new EntitlementGuard(port, { cache });

    await guard.evaluate({ tenant: "t1", featureKey: "f" });
    await guard.evaluate({ tenant: "t1", featureKey: "f" });
    expect(check).toHaveBeenCalledTimes(1); // second call served from cache

    await cache.invalidateTenant("t1");
    await guard.evaluate({ tenant: "t1", featureKey: "f" });
    expect(check).toHaveBeenCalledTimes(2);

    await cache.invalidateFeature("f");
    await guard.evaluate({ tenant: "t1", featureKey: "f" });
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("never caches a metered decision (quota is re-checked every time)", async () => {
    const port = new InMemoryEntitlementPort().set("t1", "ai", true);
    const check = vi.spyOn(port, "check");
    const guard = new EntitlementGuard(port, {
      cache: new EntitlementCache({ clock }),
      quota: new InMemoryUsageQuota(),
    });
    await guard.evaluate({ tenant: "t1", featureKey: "ai", resource: "AI_TOKEN" });
    await guard.evaluate({ tenant: "t1", featureKey: "ai", resource: "AI_TOKEN" });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("a cache failure never changes the verdict", async () => {
    const cache = new EntitlementCache({ clock });
    vi.spyOn(cache, "get").mockRejectedValue(new Error("cache down"));
    vi.spyOn(cache, "set").mockRejectedValue(new Error("cache down"));
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "f", true), {
      cache,
    });
    expect((await guard.evaluate({ tenant: "t1", featureKey: "f" })).allowed).toBe(true);
  });

  it("keys are tenant-prefixed (ADR-0008)", () => {
    expect(new EntitlementCache().key("t1", "f", "write")).toBe("entitlement:t1:f:write");
  });
});

describe("Fail-closed collaborators (P1.2 §1)", () => {
  it("denies when the policy port throws", async () => {
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "f", true), {
      policy: {
        resolve: async () => {
          throw new Error("down");
        },
      },
    });
    const d = await guard.evaluate({ tenant: "t1", featureKey: "f" });
    expect(d.allowed).toBe(false);
    expect(d.source).toBe("guard_error");
  });

  it("denies when the quota port throws", async () => {
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "f", true), {
      quota: {
        check: async () => {
          throw new Error("down");
        },
      },
    });
    const d = await guard.evaluate({ tenant: "t1", featureKey: "f", resource: "X" });
    expect(d.allowed).toBe(false);
    expect(d.source).toBe("guard_error");
  });

  it("denies when the decision port throws", async () => {
    const throwing: EntitlementPort = {
      check: async () => {
        throw new Error("licensing down");
      },
    };
    expect(
      (await new EntitlementGuard(throwing).evaluate({ tenant: "t1", featureKey: "f" })).allowed,
    ).toBe(false);
  });
});

describe("Performance (P1.2 §14)", () => {
  it("batches and de-duplicates identical requests", async () => {
    const port = new InMemoryEntitlementPort().set("t1", "f", true);
    const check = vi.spyOn(port, "check");
    const guard = new EntitlementGuard(port);
    const decisions = await guard.evaluateMany([
      { tenant: "t1", featureKey: "f" },
      { tenant: "t1", featureKey: "f" },
      { tenant: "t1", featureKey: "g" },
    ]);
    expect(decisions).toHaveLength(3);
    expect(check).toHaveBeenCalledTimes(2); // "f" de-duplicated
  });

  it("evaluates a single policy well under the 5ms budget (memoized)", async () => {
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "f", true), {
      cache: new EntitlementCache({ clock }),
    });
    await guard.evaluate({ tenant: "t1", featureKey: "f" }); // warm
    const iterations = 1000;
    const started = performance.now();
    for (let i = 0; i < iterations; i += 1) await guard.evaluate({ tenant: "t1", featureKey: "f" });
    const perEvaluation = (performance.now() - started) / iterations;
    expect(perEvaluation).toBeLessThan(5);
  });
});
