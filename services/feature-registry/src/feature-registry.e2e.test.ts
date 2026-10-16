import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { EntitlementGuard } from "@platform/entitlement";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { wireFeatureRegistry } from "./composition";
import {
  CompositeEntitlementPort,
  type LicensingDecision,
} from "./interfaces/entitlement-port.adapter";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-07-14T00:00:00.000Z") };
function wire() {
  return wireFeatureRegistry({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

const tenantId = "tenant-local";

describe("feature registry (end to end)", () => {
  it("registers → requirements → publish → resolve, and emits canonical events", async () => {
    const app = wire();

    const registered = await app.featureRegistry.register({
      key: "ai.copywriter",
      name: "AI Copywriter",
      category: "ai",
      visibility: "public",
      tenantId,
    });
    expect(registered.status).toBe(201);

    await app.featureRegistry.setRequirements({
      key: "ai.copywriter",
      requirements: { requiredPlans: ["growth"], requiredCapabilities: ["beta.ai"] },
      tenantId,
    });
    await app.featureRegistry.advance({ key: "ai.copywriter", to: "publish", tenantId });

    const resolved = await app.featureRegistry.resolve({ key: "ai.copywriter", tenantId });
    expect(resolved.body).toMatchObject({
      available: true,
      lifecycle: "active",
      publishedVersion: 1,
      requiredPlans: ["growth"],
    });

    const list = await app.featureRegistry.list({ lifecycle: "active", tenantId });
    expect((list.body as { features: { key: string }[] }).features.map((f) => f.key)).toEqual([
      "ai.copywriter",
    ]);

    await app.drainOutbox();
    expect(app.deliveredEventTypes).toEqual(
      expect.arrayContaining([
        "feature_registry.feature.registered",
        "feature_registry.feature.version_published",
      ]),
    );
  });

  it("assigns groups, compatibility and AI metadata, exposed on resolve (P1.1.1 §1/§9/§10)", async () => {
    const app = wire();
    await app.featureRegistry.register({
      key: "ai.copywriter",
      name: "AI Copywriter",
      category: "ai",
      tenantId,
    });
    await app.featureRegistry.setGroups({
      key: "ai.copywriter",
      groups: ["ai", "marketing"],
      tenantId,
    });
    await app.featureRegistry.setCompatibility({
      key: "ai.copywriter",
      compatibility: { requires: ["ai.tokens"], conflictsWith: ["legacy.copy"] },
      tenantId,
    });
    await app.featureRegistry.setAiMetadata({
      key: "ai.copywriter",
      ai: { aiDescription: "writes copy", useCases: ["product descriptions"] },
      tenantId,
    });
    await app.featureRegistry.advance({ key: "ai.copywriter", to: "publish", tenantId });

    const resolved = await app.featureRegistry.resolve({ key: "ai.copywriter", tenantId });
    expect(resolved.body).toMatchObject({
      groups: ["ai", "marketing"],
      compatibility: { requires: ["ai.tokens"], conflictsWith: ["legacy.copy"] },
      ai: { aiDescription: "writes copy", useCases: ["product descriptions"] },
    });

    await app.drainOutbox();
    expect(app.deliveredEventTypes).toEqual(
      expect.arrayContaining([
        "feature_registry.feature.group_changed",
        "feature_registry.feature.dependency_changed",
      ]),
    );
  });

  it("creates and updates a feature bundle referencing features (P1.1.1 §2)", async () => {
    const app = wire();
    const created = await app.featureRegistry.createBundle({
      key: "ai.pack",
      name: "AI Pack",
      featureKeys: ["ai.copywriter"],
      groups: ["ai"],
      tenantId,
    });
    expect(created.status).toBe(201);
    await app.featureRegistry.updateBundle({
      key: "ai.pack",
      featureKeys: ["ai.copywriter", "ai.tokens"],
      tenantId,
    });
    const list = await app.featureRegistry.listBundles({ tenantId });
    expect(
      (list.body as { bundles: { key: string; featureKeys: string[] }[] }).bundles[0]?.featureKeys,
    ).toEqual(["ai.copywriter", "ai.tokens"]);
    await app.featureRegistry.updateBundle({ key: "ai.pack", archive: true, tenantId });
    await app.drainOutbox();
    expect(app.deliveredEventTypes).toEqual(
      expect.arrayContaining([
        "feature_registry.bundle.created",
        "feature_registry.bundle.updated",
        "feature_registry.bundle.archived",
      ]),
    );
  });

  it("analyzes the capability graph (dependencies, impact, cycles) — P1.1.1 §3", async () => {
    const app = wire();
    for (const key of ["ai.tokens", "billing.metered", "ai.copywriter"]) {
      await app.featureRegistry.register({ key, name: key, category: "ai", tenantId });
      await app.featureRegistry.advance({ key, to: "publish", tenantId });
    }
    await app.featureRegistry.advance({ key: "ai.copywriter", to: "revise", tenantId });
    await app.featureRegistry.declareDependencies({
      key: "ai.copywriter",
      dependencies: [{ featureKey: "ai.tokens", minVersion: 0 }],
      tenantId,
    });
    await app.featureRegistry.setCompatibility({
      key: "ai.copywriter",
      compatibility: { requires: ["billing.metered"] },
      tenantId,
    });
    await app.featureRegistry.advance({ key: "ai.copywriter", to: "publish", tenantId });

    const graph = await app.featureRegistry.analyzeGraph({ key: "ai.copywriter", tenantId });
    const body = graph.body as { acyclic: boolean; focus: { transitiveDependencies: string[] } };
    expect(body.acyclic).toBe(true);
    expect(body.focus.transitiveDependencies).toEqual(["ai.tokens", "billing.metered"]);
  });

  it("sets lifecycle policy, constraints, cost profile, documentation and analytics metadata (P1.1.2 §1-4/§8)", async () => {
    const app = wire();
    await app.featureRegistry.register({
      key: "ai.copywriter",
      name: "AI Copywriter",
      category: "ai",
      tenantId,
    });
    await app.featureRegistry.setMetadata({
      key: "ai.copywriter",
      lifecyclePolicy: "general_availability",
      constraints: { maxTokens: 100000, maxAiCredits: -1 },
      cost: { estimatedCost: 5, aiWeight: 0.9, billingStrategy: "metered" },
      documentation: { documentationUrl: "https://docs/ai.copywriter", examples: ["ex1"] },
      analytics: { adoptionScore: 42, maturity: 3 },
      tenantId,
    });
    await app.featureRegistry.advance({ key: "ai.copywriter", to: "publish", tenantId });
    const resolved = await app.featureRegistry.resolve({ key: "ai.copywriter", tenantId });
    expect(resolved.body).toMatchObject({
      lifecyclePolicy: "general_availability",
      constraints: { maxTokens: 100000, maxAiCredits: -1 },
      cost: { estimatedCost: 5, aiWeight: 0.9, billingStrategy: "metered" },
      documentation: { documentationUrl: "https://docs/ai.copywriter" },
      analytics: { adoptionScore: 42, maturity: 3 },
    });
  });

  it("validates the whole registry deterministically (P1.1.2 §7)", async () => {
    const app = wire();
    await app.featureRegistry.register({
      key: "ai.tokens",
      name: "AI Tokens",
      category: "ai",
      tenantId,
    });
    await app.featureRegistry.advance({ key: "ai.tokens", to: "publish", tenantId });
    await app.featureRegistry.register({
      key: "ai.copywriter",
      name: "AI Copywriter",
      category: "ai",
      tenantId,
    });
    await app.featureRegistry.declareDependencies({
      key: "ai.copywriter",
      dependencies: [{ featureKey: "ai.tokens", minVersion: 0 }],
      tenantId,
    });
    await app.featureRegistry.advance({ key: "ai.copywriter", to: "publish", tenantId });
    const clean = await app.featureRegistry.validate({ tenantId });
    expect((clean.body as { valid: boolean }).valid).toBe(true);

    // introduce a missing dependency
    await app.featureRegistry.register({
      key: "ai.broken",
      name: "Broken",
      category: "ai",
      tenantId,
    });
    await app.featureRegistry.declareDependencies({
      key: "ai.broken",
      dependencies: [{ featureKey: "does.not.exist", minVersion: 0 }],
      tenantId,
    });
    await app.featureRegistry.advance({ key: "ai.broken", to: "publish", tenantId });
    const broken = await app.featureRegistry.validate({ tenantId });
    expect((broken.body as { valid: boolean; issues: { code: string }[] }).valid).toBe(false);
    expect(
      (broken.body as { issues: { code: string }[] }).issues.some(
        (i) => i.code === "missing_dependency",
      ),
    ).toBe(true);
  });

  it("resolve reports an unpublished/unknown feature as unavailable (fail-closed input to the guard)", async () => {
    const app = wire();
    await app.featureRegistry.register({ key: "ai.beta", name: "Beta", category: "ai", tenantId });
    const draftResolve = await app.featureRegistry.resolve({ key: "ai.beta", tenantId });
    expect((draftResolve.body as { available: boolean }).available).toBe(false); // draft, not published
    const unknown = await app.featureRegistry.resolve({ key: "does.not.exist", tenantId });
    expect(unknown.status).toBe(404);
  });

  it("EntitlementGuard gates a command through the CompositeEntitlementPort (registry availability × licensing decision)", async () => {
    const app = wire();
    await app.featureRegistry.register({
      key: "ai.copywriter",
      name: "AI Copywriter",
      category: "ai",
      tenantId,
    });
    await app.featureRegistry.advance({ key: "ai.copywriter", to: "publish", tenantId });

    // Fakes for the composition-root collaborators (no cross-context import): availability from THIS registry,
    // decision emulating Licensing's 5-tier resolver.
    const resolveFeatureAvailability = async (featureKey: string): Promise<boolean | null> => {
      const res = await app.featureRegistry.resolve({ key: featureKey, tenantId });
      if (res.status === 404) return null;
      return (res.body as { available: boolean }).available;
    };
    const entitledTenants = new Set(["t-entitled"]);
    const checkLicensing = async (input: {
      tenantRef: string;
      featureKey: string;
      featureAvailable: boolean;
    }): Promise<LicensingDecision> => {
      if (!input.featureAvailable) return { allowed: false, source: "feature_unavailable" };
      return entitledTenants.has(input.tenantRef)
        ? { allowed: true, source: "plan" }
        : { allowed: false, source: "none" };
    };
    const guard = new EntitlementGuard(
      new CompositeEntitlementPort({ resolveFeatureAvailability, checkLicensing }),
    );

    const runCommand = async (): Promise<Result<string, DomainError>> => ok("did the thing");

    const allowed = await guard.guard(
      { tenant: "t-entitled", featureKey: "ai.copywriter" },
      runCommand,
    );
    expect(allowed.ok).toBe(true);

    const denied = await guard.guard({ tenant: "t-free", featureKey: "ai.copywriter" }, runCommand);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("FORBIDDEN");

    const unknownFeature = await guard.ensure({
      tenant: "t-entitled",
      featureKey: "ghost.feature",
    });
    expect(unknownFeature.ok).toBe(false); // fail-closed on unknown feature
  });
});
