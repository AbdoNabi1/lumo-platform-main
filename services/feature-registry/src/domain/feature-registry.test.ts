import { describe, expect, it } from "vitest";
import { UniqueEntityId, isDomainError } from "@platform/domain";
import { FeatureDefinition } from "./feature-definition";

function id(): UniqueEntityId {
  return UniqueEntityId.from(`id-${Math.random().toString(36).slice(2)}`);
}
const now = new Date("2026-07-14T00:00:00.000Z");

function register(overrides: Partial<{ key: string; category: string }> = {}): FeatureDefinition {
  return FeatureDefinition.register(
    id(),
    {
      key: overrides.key ?? "ai.copywriter",
      name: "AI Copywriter",
      category: overrides.category ?? "ai",
      visibility: "public",
      description: "Generates copy",
    },
    "evt-1",
    now,
  );
}

describe("FeatureDefinition (Feature Registry domain, ADR-0027)", () => {
  it("registers a feature with an initial draft (v1) in the draft lifecycle", () => {
    const f = register();
    expect(f.lifecycle).toBe("draft");
    expect(f.versions).toHaveLength(1);
    expect(f.draft()?.versionNumber).toBe(1);
    expect(f.publishedVersionNumber).toBeNull();
    expect(f.effectiveSpec().category).toBe("ai");
    expect(f.pullDomainEvents()).toHaveLength(1);
  });

  it("rejects an invalid feature key", () => {
    try {
      FeatureDefinition.register(id(), { key: "Not A Key", name: "x", category: "ai" }, "e", now);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
    }
  });

  it("sets requirements and dependencies on the draft, then publishes an immutable version → active", () => {
    const f = register();
    f.setRequirements(
      {
        requiredPlans: ["growth"],
        requiredPermissions: ["ai.use"],
        requiredCapabilities: ["beta.ai"],
      },
      "e2",
      now,
    );
    f.setDependencies([{ featureKey: "ai.tokens", minVersion: 1 }], "e3", now);
    f.publish("e4", now);
    expect(f.lifecycle).toBe("active");
    expect(f.publishedVersionNumber).toBe(1);
    expect(f.publishedVersion()?.status).toBe("published");
    expect(f.effectiveSpec().requirements.requiredPlans).toEqual(["growth"]);
    expect(f.effectiveSpec().dependencies).toEqual([{ featureKey: "ai.tokens", minVersion: 1 }]);
  });

  it("rejects a self-dependency", () => {
    const f = register({ key: "ai.copywriter" });
    try {
      f.setDependencies([{ featureKey: "ai.copywriter", minVersion: 0 }], "e", now);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
    }
  });

  it("revises into a new immutable version without mutating the published one", () => {
    const f = register();
    f.publish("e1", now);
    f.revise("e2", now);
    expect(f.draft()?.versionNumber).toBe(2);
    f.editDraft({ description: "v2 copy" }, "e3", now);
    // published v1 spec is untouched until v2 is published
    expect(f.versionAt(1)?.spec.description).toBe("Generates copy");
    f.publish("e4", now);
    expect(f.publishedVersionNumber).toBe(2);
    expect(f.versions).toHaveLength(2);
  });

  it("blocks editing when no draft is open", () => {
    const f = register();
    f.publish("e1", now);
    try {
      f.editDraft({ description: "x" }, "e2", now);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
    }
  });

  it("deprecates, replaces with a migration target, and soft-removes (terminal)", () => {
    const f = register();
    f.publish("e1", now);
    f.replaceWith("ai.copywriter_v2", "e2", now);
    expect(f.lifecycle).toBe("deprecated");
    expect(f.replacementKey).toBe("ai.copywriter_v2");
    f.softRemove("e3", now);
    expect(f.lifecycle).toBe("removed");
    try {
      f.softRemove("e4", now);
      expect.unreachable("removing twice should throw");
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
    }
  });

  it("carries the canonical event name + lifecycle on every fact", () => {
    const f = register();
    f.publish("e1", now);
    const events = f.pullDomainEvents();
    // `DomainEvent.data` is generic per-event-type; this test only reads a known `event` field —
    // needs the `unknown` hop since the narrow view has no structural overlap with `DomainEvent`.
    const names = events.map((e) => (e as unknown as { data: { event: string } }).data.event);
    expect(names).toContain("feature_registry.feature.registered");
    expect(names).toContain("feature_registry.feature.version_published");
  });
});
