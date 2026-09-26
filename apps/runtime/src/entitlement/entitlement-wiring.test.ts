import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import {
  EntitlementCache,
  InMemoryEntitlementPort,
  InMemoryUsageQuota,
} from "@platform/entitlement";
import { wireFeatureRegistry } from "@platform/feature-registry";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
  type Subscriber,
} from "@platform/messaging";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { LicensingEntitlementPort, type LicensingDecider } from "./licensing-entitlement.adapter";
import { EntitlementCacheInvalidator } from "./entitlement-invalidation.consumer";
import {
  ENTITLEMENT_PUBLISHED_EVENTS,
  EntitlementEventTranslator,
  OutboxEntitlementEventEmitter,
} from "./entitlement-events";
import { EntitlementConsoleProjection } from "./entitlement-read-models";
import { EntitlementMiddleware } from "./entitlement-middleware";
import { wireEntitlement } from "./wire-entitlement";

function ids(): IdGenerator {
  let n = 0;
  return { generate: () => `id-${(n += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-07-14T00:00:00.000Z") };
const run = async (): Promise<Result<string, DomainError>> => ok("ran");

/**
 * In-memory Feature Registry (real wiring) + a structural Licensing fake, with a published,
 * entitled feature for tenant t1.
 *
 * **Disclosed deviation from the dirty-tree source:** the dirty tree's own copy of this test wires
 * a real `wireLicensing()` and calls `createPlan({ spec: … })` / `advancePlan` / `startSubscription`.
 * None of those exist on the evidenced, gate-verified `LicensingController` actually committed at G5
 * (`G5_MILESTONE_REPORT.md` / `SPRINT_5_5_SAAS_FOUNDATION_REPORT.md` — its plan/subscription surface
 * is `createPlan`/`publishPlanVersion`/`createSubscription`/`activateSubscription`). No primary
 * source documents Licensing gaining a `checkEntitlement` PDP endpoint or that expanded plan/
 * subscription API — it is unattested drift, not evidenced history. This fake reproduces the same
 * tenant→plan relationship the test asserts on (t1 entitled via "starter", t-free not entitled),
 * using the same structural-fake style the sibling `describe` blocks in this file already use for
 * `LicensingDecider`, instead of inventing new methods on the real, already-committed controller.
 */
async function setup() {
  const featureRegistry = wireFeatureRegistry({
    serializer: new InMemoryEventSerializer(),
    idGenerator: ids(),
    clock,
  });

  // T10.7: a definition is a per-tenant row and the port reads the asked-about tenant's catalog, so
  // every tenant this file asks about publishes its own copy.
  for (const tenantId of ["t1", "t-free"]) {
    await featureRegistry.featureRegistry.register({
      key: "ai.copy",
      name: "AI Copy",
      category: "ai",
      tenantId,
    });
    await featureRegistry.featureRegistry.setRequirements({
      key: "ai.copy",
      requirements: { requiredPlans: ["starter"] },
      tenantId,
    });
    await featureRegistry.featureRegistry.advance({ key: "ai.copy", to: "publish", tenantId });
  }

  const licensing: LicensingDecider = {
    async checkEntitlement({ tenantRef }) {
      return tenantRef === "t1"
        ? { status: 200, body: { allowed: true, source: "plan" } }
        : { status: 200, body: { allowed: false, source: "no_subscription" } };
    },
  };

  return { licensing, featureRegistry: featureRegistry.featureRegistry };
}

describe("P1.3 — Licensing/FeatureRegistry entitlement adapter (real PDP delegation)", () => {
  it("allows an entitled, published feature and denies an unregistered one (fail-closed)", async () => {
    const { licensing, featureRegistry } = await setup();
    const port = new LicensingEntitlementPort({
      featureRegistry,
      licensing,
    });

    const allowed = await port.check({ tenant: "t1", featureKey: "ai.copy" });
    expect(allowed.allowed).toBe(true);
    expect(allowed.explain?.requiredPlan).toBe("starter");

    const unknown = await port.check({ tenant: "t1", featureKey: "ghost.feature" });
    expect(unknown.allowed).toBe(false);
    expect(unknown.source).toBe("feature_unknown");

    const notEntitled = await port.check({ tenant: "t-free", featureKey: "ai.copy" });
    expect(notEntitled.allowed).toBe(false);
  });

  it("wires a production guard that enforces through the real adapter", async () => {
    const { licensing, featureRegistry } = await setup();
    const wired = wireEntitlement({
      licensing,
      featureRegistry,
      quota: new InMemoryUsageQuota(),
      clock,
    });
    expect(await wired.middleware.can({ tenant: "t1", featureKey: "ai.copy" })).toBe(true);
    const gated = await wired.middleware.api({ tenant: "t1", featureKey: "ai.copy" }, run);
    expect(gated.ok).toBe(true);
    const denied = await wired.middleware.api({ tenant: "t-free", featureKey: "ai.copy" }, run);
    expect(denied.ok).toBe(false);
    expect(wired.metrics.snapshot().totalEvaluations).toBeGreaterThan(0);
  });
});

describe("P1.3 — Admin requires BOTH RBAC and entitlement (§17)", () => {
  it("denies when RBAC fails even if entitled, and when entitlement fails even if RBAC passes", async () => {
    const guard = wireEntitlement({
      licensing: {
        checkEntitlement: async () => ({ status: 200, body: { allowed: true, source: "plan" } }),
      },
      featureRegistry: {
        resolve: async () => ({
          status: 200,
          body: { available: true, requiredPlans: [], requiredCapabilities: [], dependencies: [] },
        }),
      },
      clock,
    }).middleware;
    expect((await guard.admin({ tenant: "t1", featureKey: "f" }, false, run)).ok).toBe(false); // RBAC deny
    expect((await guard.admin({ tenant: "t1", featureKey: "f" }, true, run)).ok).toBe(true); // both pass

    const denyGuard = new EntitlementMiddleware(
      wireEntitlement({
        licensing: {
          checkEntitlement: async () => ({ status: 200, body: { allowed: false, source: "none" } }),
        },
        featureRegistry: {
          resolve: async () => ({
            status: 200,
            body: {
              available: false,
              requiredPlans: [],
              requiredCapabilities: [],
              dependencies: [],
            },
          }),
        },
        clock,
      }).guard,
    );
    expect((await denyGuard.admin({ tenant: "t1", featureKey: "f" }, true, run)).ok).toBe(false); // RBAC ok, entitlement deny
  });
});

describe("P1.3 — Canonical event emission (§6)", () => {
  it("emits 3-segment canonical events for grant / deny / quota / simulation", async () => {
    const store = new InMemoryOutboxStore();
    const outbox = new OutboxWriter({
      store,
      translator: new EntitlementEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "entitlement",
    });
    const bus = new InMemoryEventBus();
    const delivered: string[] = [];
    const sink: Subscriber = async (r) => void delivered.push(r.headers.type ?? r.topic);
    for (const t of ENTITLEMENT_PUBLISHED_EVENTS) bus.subscribe(`${t}.v1`, sink);
    const relay = new OutboxRelay({ store, publisher: new InMemoryEventPublisher(bus), clock });
    const emitter = new OutboxEntitlementEventEmitter({
      outbox,
      context: rootEventContext(ids()),
      idGenerator: ids(),
      clock,
    });

    const port = new InMemoryEntitlementPort().set("t1", "f", true);
    const guard = wireEntitlement({
      licensing: {
        checkEntitlement: async () => ({ status: 200, body: { allowed: true, source: "plan" } }),
      },
      featureRegistry: {
        resolve: async () => ({
          status: 200,
          body: { available: true, requiredPlans: [], requiredCapabilities: [], dependencies: [] },
        }),
      },
      telemetry: emitter,
      quota: new InMemoryUsageQuota().setLimit("t1", "R", { limit: 1 }).setUsed("t1", "R", 1),
      clock,
    }).guard;
    void port;

    await guard.evaluate({ tenant: "t1", featureKey: "f" }); // granted
    await guard.evaluate({ tenant: "t1", featureKey: "f", resource: "R" }); // quota exceeded
    await guard.simulate({ tenant: "t1", featureKey: "f" }); // simulation
    await new Promise((r) => setTimeout(r, 0)); // let fire-and-forget outbox writes settle
    await relay.drainOnce();

    expect(delivered).toEqual(
      expect.arrayContaining([
        "entitlement.decision.granted",
        "entitlement.quota.exceeded",
        "entitlement.simulation.executed",
      ]),
    );
    // every published type is canonical 3-segment
    for (const t of ENTITLEMENT_PUBLISHED_EVENTS) expect(t.split(".")).toHaveLength(3);
  });
});

describe("P1.3 — Event-driven cache invalidation (§8)", () => {
  it("invalidates by feature and by tenant on the right events, no polling", async () => {
    const cache = new EntitlementCache({ clock });
    await cache.set("t1", "ai.copy", "write", {
      featureKey: "ai.copy",
      allowed: true,
      source: "plan",
    });
    await cache.set("t2", "ai.copy", "write", {
      featureKey: "ai.copy",
      allowed: true,
      source: "plan",
    });
    const invalidator = new EntitlementCacheInvalidator(cache);

    await invalidator.onEvent("licensing.subscription.suspended", { key: "t1" });
    expect(await cache.get("t1", "ai.copy", "write")).toBeNull();
    expect(await cache.get("t2", "ai.copy", "write")).not.toBeNull();

    await invalidator.onEvent("feature_registry.feature.version_published", { key: "ai.copy" });
    expect(await cache.get("t2", "ai.copy", "write")).toBeNull();

    expect(EntitlementCacheInvalidator.SUBSCRIBED_EVENTS.length).toBeGreaterThan(0);
  });
});

describe("P1.3 — Platform Console read models (§10, read side only)", () => {
  it("projects decision/quota/simulation history and top denied/granted", () => {
    const projection = new EntitlementConsoleProjection();
    projection.project({
      aggregateId: "t1",
      aggregate: "decision",
      event: "entitlement.decision.granted",
      tenant: "t1",
      featureKey: "ai.copy",
      allowed: true,
      source: "plan",
      policy: "allow",
      target: "api",
      quotaState: "none",
      decisionId: "d1",
    });
    projection.project({
      aggregateId: "t1",
      aggregate: "decision",
      event: "entitlement.decision.denied",
      tenant: "t1",
      featureKey: "ai.pro",
      allowed: false,
      source: "none",
      policy: "deny",
      target: "api",
      quotaState: "none",
      decisionId: "d2",
    });
    projection.project({
      aggregateId: "t1",
      aggregate: "quota",
      event: "entitlement.quota.exceeded",
      tenant: "t1",
      featureKey: "ai.copy",
      allowed: false,
      source: "quota_exceeded",
      policy: "allow",
      target: "api",
      quotaState: "hard_exceeded",
      decisionId: "d3",
    });
    const view = projection.view();
    expect(view.decisionHistory.length).toBe(3);
    expect(view.quotaHistory.length).toBe(1);
    expect(view.topGrantedFeatures[0]?.featureKey).toBe("ai.copy");
    expect(view.topDeniedFeatures.map((f) => f.featureKey)).toContain("ai.pro");
  });
});
