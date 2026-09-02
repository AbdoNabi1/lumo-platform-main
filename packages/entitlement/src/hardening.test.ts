import { describe, expect, it, vi } from "vitest";
import type { Clock } from "@platform/contracts";
import { EntitlementCache } from "./cache";
import {
  EntitlementGuard,
  InMemoryEntitlementAudit,
  InMemoryEntitlementPort,
  InMemoryPolicyPort,
  type EntitlementDecision,
  type EntitlementPort,
  type EntitlementTelemetry,
} from "./entitlement-guard";
import { EntitlementMetrics } from "./metrics";
import { TRACE_STAGES } from "./trace";
import { InMemoryUsageQuota } from "./quota";

const clock: Clock = { now: () => new Date("2026-07-14T00:00:00.000Z") };

/** A decision port that echoes rich explanation signals (what Licensing supplies in production). */
function explainingPort(
  allowed: boolean,
  explain: EntitlementDecision["explain"],
  source = "plan",
): EntitlementPort {
  return {
    check: async (r) => ({
      featureKey: r.featureKey,
      allowed,
      source,
      ...(explain !== undefined ? { explain } : {}),
    }),
  };
}

describe("Policy Explanation Engine (P1.2.1 §1)", () => {
  it("returns a complete, deterministic explanation read model", async () => {
    const port = explainingPort(
      false,
      {
        requiredPlan: "growth",
        currentPlan: "starter",
        missingCapability: "ai.beta",
        missingDependency: "ai.tokens",
        merchantOverride: "disabled",
        platformOverride: undefined,
        featureFlagStatus: "off",
      },
      "none",
    );
    const guard = new EntitlementGuard(port, { clock });
    const why = await guard.why({ tenant: "t1", featureKey: "ai.copy" });
    expect(why).toMatchObject({
      featureKey: "ai.copy",
      decision: "deny",
      requiredPlan: "growth",
      currentPlan: "starter",
      missingCapability: "ai.beta",
      missingDependency: "ai.tokens",
      merchantOverride: "disabled",
      featureFlagStatus: "off",
      evaluatedAt: "2026-07-14T00:00:00.000Z",
    });
    expect(why.decisionId).toMatch(/^dec_[0-9a-f]{8}$/);
    // deterministic decision id
    const again = await guard.why({ tenant: "t1", featureKey: "ai.copy" });
    expect(again.decisionId).toBe(why.decisionId);
  });

  it("why() never mutates — no audit, no cache write", async () => {
    const audit = new InMemoryEntitlementAudit();
    const cache = new EntitlementCache({ clock });
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "f", true), {
      audit,
      cache,
      clock,
    });
    await guard.why({ tenant: "t1", featureKey: "f" });
    expect(audit.records).toHaveLength(0);
    expect(cache.size).toBe(0);
  });
});

describe("Dry Run Engine (P1.2.1 §2)", () => {
  it("simulate reuses the pipeline but never audits or emits", async () => {
    const audit = new InMemoryEntitlementAudit();
    const onDecision = vi.fn();
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "f", true), {
      audit,
      onDecision,
      clock,
    });
    const sim = await guard.simulate({ tenant: "t1", featureKey: "f" });
    expect(sim.simulated).toBe(true);
    expect(sim.decision.allowed).toBe(true);
    expect(sim.explanation.decision).toBe("allow");
    expect(sim.trace.steps).toHaveLength(TRACE_STAGES.length);
    expect(audit.records).toHaveLength(0);
    expect(onDecision).not.toHaveBeenCalled(); // no business-side emit on simulate
  });

  it("simulateFeature / simulatePlan / simulateQuota / simulateWorkflow reuse the same pipeline", async () => {
    const port = new InMemoryEntitlementPort().set("t1", "a", true).set("t1", "b", false);
    const guard = new EntitlementGuard(port, {
      quota: new InMemoryUsageQuota()
        .setLimit("t1", "AI_TOKEN", { limit: 10 })
        .setUsed("t1", "AI_TOKEN", 10),
      clock,
    });
    expect((await guard.simulateFeature("t1", "a")).decision.allowed).toBe(true);
    const plan = await guard.simulatePlan("t1", ["a", "b"]);
    expect(plan.map((r) => r.decision.allowed)).toEqual([true, false]);
    const quota = await guard.simulateQuota("t1", "a", "AI_TOKEN");
    expect(quota.decision.allowed).toBe(false); // hard limit
    const wf = await guard.simulateWorkflow("t1", ["a", "b"]);
    expect(wf).toHaveLength(2);
  });

  it("simulation does not consume quota (metered simulate leaves counters untouched)", async () => {
    const quota = new InMemoryUsageQuota()
      .setLimit("t1", "AI_TOKEN", { limit: 5 })
      .setUsed("t1", "AI_TOKEN", 4);
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "ai", true), {
      quota,
      clock,
    });
    await guard.simulateQuota("t1", "ai", "AI_TOKEN", 1); // would reach 5 (ok)
    const second = await guard.simulateQuota("t1", "ai", "AI_TOKEN", 1);
    expect(second.decision.quota?.used).toBe(5); // still computed from base 4, not accumulated
  });
});

describe("Decision Trace (P1.2.1 §3)", () => {
  it("traces every frozen stage with input/output/explanation/elapsed and marks the decisive tier", async () => {
    const port = explainingPort(false, { missingDependency: "ai.tokens" }, "feature_unavailable");
    const guard = new EntitlementGuard(port, { clock });
    const trace = await guard.trace({ tenant: "t1", featureKey: "ai.copy" });
    expect(trace.steps.map((s) => s.stage)).toEqual([...TRACE_STAGES]);
    for (const step of trace.steps) {
      expect(step).toHaveProperty("input");
      expect(step).toHaveProperty("output");
      expect(step).toHaveProperty("explanation");
      expect(step.elapsedMs).toBeGreaterThanOrEqual(0);
    }
    expect(trace.steps.some((s) => s.decisive)).toBe(true);
    expect(trace.allowed).toBe(false);
  });

  it("is deterministic — same decision yields the same trace shape", async () => {
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "f", true), {
      clock,
    });
    const a = await guard.trace({ tenant: "t1", featureKey: "f" });
    const b = await guard.trace({ tenant: "t1", featureKey: "f" });
    expect(a.steps.map((s) => s.output)).toEqual(b.steps.map((s) => s.output));
    expect(a.decisionId).toBe(b.decisionId);
  });
});

describe("Decision Metrics (P1.2.1 §4)", () => {
  it("accumulates allow/deny ratios, cache hit/miss ratios and denial breakdowns", async () => {
    const metrics = new EntitlementMetrics();
    const port = new InMemoryEntitlementPort().set("t1", "ok", true).set("t1", "no", false);
    const guard = new EntitlementGuard(port, {
      metrics,
      cache: new EntitlementCache({ clock }),
      quota: new InMemoryUsageQuota().setLimit("t1", "R", { limit: 1 }).setUsed("t1", "R", 1),
      policy: new InMemoryPolicyPort().set("t1", "ro", "read_only"),
      clock,
    });

    await guard.evaluate({ tenant: "t1", featureKey: "ok" }); // allow (miss)
    await guard.evaluate({ tenant: "t1", featureKey: "ok" }); // allow (cache hit)
    await guard.evaluate({ tenant: "t1", featureKey: "no" }); // deny
    await guard.evaluate({ tenant: "t1", featureKey: "ok", resource: "R" }); // quota deny
    await guard.evaluate({ tenant: "t1", featureKey: "ro", action: "write" }); // policy deny (needs entitlement)

    const snap = metrics.snapshot();
    expect(snap.totalEvaluations).toBe(5);
    expect(snap.allows + snap.denies).toBe(5);
    expect(snap.cacheHits).toBe(1);
    expect(snap.quotaDenials).toBe(1);
    expect(snap.allowRatio).toBeCloseTo(snap.allows / 5);
    expect(snap.cacheHitRatio + snap.cacheMissRatio).toBeCloseTo(1);
  });

  it("simulation does not pollute runtime metrics", async () => {
    const metrics = new EntitlementMetrics();
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "f", true), {
      metrics,
      clock,
    });
    await guard.simulate({ tenant: "t1", featureKey: "f" });
    await guard.why({ tenant: "t1", featureKey: "f" });
    expect(metrics.snapshot().totalEvaluations).toBe(0);
  });
});

describe("Observability (P1.2.1 §11)", () => {
  it("emits telemetry with correlation id, decision id, latency and simulated flag", async () => {
    const events: { correlationId?: string; decisionId?: string; simulated: boolean }[] = [];
    const telemetry: EntitlementTelemetry = {
      onDecision: (e) =>
        events.push({
          correlationId: e.decision.correlationId,
          decisionId: e.decision.decisionId,
          simulated: e.simulated,
        }),
    };
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "f", true), {
      telemetry,
      clock,
    });
    await guard.evaluate({ tenant: "t1", featureKey: "f", correlationId: "corr-1" });
    await guard.simulate({ tenant: "t1", featureKey: "f", correlationId: "corr-2" });
    expect(events[0]).toMatchObject({ correlationId: "corr-1", simulated: false });
    expect(events[0]?.decisionId).toMatch(/^dec_/);
    expect(events[1]).toMatchObject({ correlationId: "corr-2", simulated: true });
  });
});

describe("SDK surface (P1.2.1 §6) + performance (§10)", () => {
  it("can() is a non-mutating boolean", async () => {
    const audit = new InMemoryEntitlementAudit();
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "f", true), {
      audit,
      clock,
    });
    expect(await guard.can({ tenant: "t1", featureKey: "f" })).toBe(true);
    expect(await guard.can({ tenant: "t1", featureKey: "missing" })).toBe(false);
    expect(audit.records).toHaveLength(0);
  });

  it("explanation adds well under the 1ms budget when warmed (§10)", async () => {
    const guard = new EntitlementGuard(new InMemoryEntitlementPort().set("t1", "f", true), {
      cache: new EntitlementCache({ clock }),
      clock,
    });
    await guard.evaluate({ tenant: "t1", featureKey: "f" }); // warm
    const iterations = 1000;
    const started = performance.now();
    for (let i = 0; i < iterations; i += 1) await guard.why({ tenant: "t1", featureKey: "f" });
    expect((performance.now() - started) / iterations).toBeLessThan(1);
  });
});
