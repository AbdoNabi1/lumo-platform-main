import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
import { FeatureBundle } from "../domain/feature-bundle";
import { FeatureDefinition } from "../domain/feature-definition";
import { FeatureRegistryEventTranslator } from "./feature-registry-event-translator";
import {
  InMemoryFeatureBundleRepository,
  InMemoryFeatureDefinitionRepository,
} from "./in-memory-repositories";

function monotonicIds() {
  let n = 0;
  return () => `00000000-0000-7000-8000-${(n++).toString().padStart(12, "0")}`;
}

const clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function wire() {
  const nextId = monotonicIds();
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new FeatureRegistryEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "feature-registry",
  });
  const context = rootEventContext({ generate: nextId });
  return {
    features: new InMemoryFeatureDefinitionRepository({ outbox, context }),
    bundles: new InMemoryFeatureBundleRepository({ outbox, context }),
    nextId,
  };
}

describe("InMemoryFeatureDefinitionRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's feature by key or list, through a single repository instance", async () => {
    const { features, nextId } = wire();
    const feature = FeatureDefinition.register(
      UniqueEntityId.from(nextId()),
      { key: "ai.copywriter", name: "AI Copywriter", category: "ai", tenantId: "tenant-a" },
      nextId(),
      clock.now(),
    );
    await features.save(feature, "tenant-a");

    expect(await features.findByKey("ai.copywriter", "tenant-a")).not.toBeNull();
    expect(await features.findByKey("ai.copywriter", "tenant-b")).toBeNull();

    const listA = await features.list("tenant-a");
    const listB = await features.list("tenant-b");
    expect(listA.map((f) => f.key)).toContain("ai.copywriter");
    expect(listB.map((f) => f.key)).not.toContain("ai.copywriter");
  });
});

describe("InMemoryFeatureBundleRepository tenant isolation (ADR-0014, WP-10 T10.5)", () => {
  it("does not let tenant A read tenant B's bundle by key or list, through a single repository instance", async () => {
    const { bundles, nextId } = wire();
    const bundle = FeatureBundle.create(
      UniqueEntityId.from(nextId()),
      { key: "ai.pack", name: "AI Pack", tenantId: "tenant-a" },
      nextId(),
      clock.now(),
    );
    await bundles.save(bundle, "tenant-a");

    expect(await bundles.findByKey("ai.pack", "tenant-a")).not.toBeNull();
    expect(await bundles.findByKey("ai.pack", "tenant-b")).toBeNull();

    const listA = await bundles.list("tenant-a");
    const listB = await bundles.list("tenant-b");
    expect(listA.map((b) => b.key)).toContain("ai.pack");
    expect(listB.map((b) => b.key)).not.toContain("ai.pack");
  });
});

describe("InMemoryFeatureDefinitionRepository write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("feature-registry", async (outbox, tenantId) => {
      const nextId = monotonicIds();
      const repository = new InMemoryFeatureDefinitionRepository({
        outbox,
        context: rootEventContext({ generate: nextId }),
      });
      const agg = FeatureDefinition.register(
        UniqueEntityId.from(nextId()),
        { key: "ai.copywriter", name: "AI Copywriter", category: "ai", tenantId },
        nextId(),
        clock.now(),
      );
      await repository.save(agg, tenantId);
    });
  });
});

describe("the same key registered by two tenants (T10.7)", () => {
  it("keeps both: the second tenant's save does not replace the first's, for definitions and bundles", async () => {
    const { features, bundles, nextId } = wire();
    for (const tenantId of ["tenant-a", "tenant-b"]) {
      await features.save(
        FeatureDefinition.register(
          UniqueEntityId.from(nextId()),
          { key: "ai.copywriter", name: `AI ${tenantId}`, category: "ai", tenantId },
          nextId(),
          clock.now(),
        ),
        tenantId,
      );
      await bundles.save(
        FeatureBundle.create(
          UniqueEntityId.from(nextId()),
          { key: "growth", name: `Growth ${tenantId}`, featureKeys: [], tenantId },
          nextId(),
          clock.now(),
        ),
        tenantId,
      );
    }

    expect((await features.findByKey("ai.copywriter", "tenant-a"))?.name).toBe("AI tenant-a");
    expect((await features.findByKey("ai.copywriter", "tenant-b"))?.name).toBe("AI tenant-b");
    expect((await bundles.findByKey("growth", "tenant-a"))?.name).toBe("Growth tenant-a");
    expect((await bundles.findByKey("growth", "tenant-b"))?.name).toBe("Growth tenant-b");
  });
});
