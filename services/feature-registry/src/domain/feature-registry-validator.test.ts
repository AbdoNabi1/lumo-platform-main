import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { FeatureDefinition } from "./feature-definition";
import { FeatureBundle } from "./feature-bundle";
import { FeatureRegistryValidator } from "./feature-registry-validator";

const now = new Date("2026-07-14T00:00:00.000Z");
let n = 0;
function id(): UniqueEntityId {
  return UniqueEntityId.from(`id-${(n += 1)}`);
}

function feature(
  key: string,
  opts: {
    requires?: string[];
    deps?: string[];
    policy?: "general_availability" | "experimental";
  } = {},
): FeatureDefinition {
  const f = FeatureDefinition.register(
    id(),
    { key, name: key, category: "ai", tenantId: "tenant-1" },
    "e",
    now,
  );
  if (opts.deps !== undefined)
    f.setDependencies(
      opts.deps.map((d) => ({ featureKey: d, minVersion: 0 })),
      "e",
      now,
    );
  if (opts.requires !== undefined) f.setCompatibility({ requires: opts.requires }, "e", now);
  if (opts.policy !== undefined) f.setMetadata({ lifecyclePolicy: opts.policy }, "e", now);
  f.publish("e", now);
  return f;
}

describe("FeatureRegistryValidator (P1.1.2 §7)", () => {
  it("passes a well-formed registry", () => {
    const report = new FeatureRegistryValidator().validate([
      feature("ai.tokens"),
      feature("ai.copy", { deps: ["ai.tokens"] }),
    ]);
    expect(report.valid).toBe(true);
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("flags a missing dependency", () => {
    const report = new FeatureRegistryValidator().validate([
      feature("ai.copy", { deps: ["ai.tokens"] }),
    ]);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.code === "missing_dependency")).toBe(true);
  });

  it("detects a circular dependency deterministically", () => {
    const a = feature("a", { deps: ["b"] });
    const b = feature("b", { deps: ["a"] });
    const report = new FeatureRegistryValidator().validate([a, b]);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.code === "circular_dependency")).toBe(true);
    // deterministic ordering
    const again = new FeatureRegistryValidator().validate([b, a]);
    expect(again.issues.map((i) => i.code)).toEqual(report.issues.map((i) => i.code));
  });

  it("flags requires ∩ conflicts as invalid compatibility", () => {
    const f = FeatureDefinition.register(
      id(),
      { key: "x", name: "x", category: "ai", tenantId: "tenant-1" },
      "e",
      now,
    );
    f.setCompatibility({ requires: ["y"], conflictsWith: ["y"] }, "e", now);
    f.publish("e", now);
    const report = new FeatureRegistryValidator().validate([f, feature("y")]);
    expect(report.issues.some((i) => i.code === "invalid_compatibility")).toBe(true);
  });

  it("warns on a GA feature with no documentation, and on a non-canonical constraint", () => {
    const f = FeatureDefinition.register(
      id(),
      { key: "ga", name: "ga", category: "ai", tenantId: "tenant-1" },
      "e",
      now,
    );
    f.setMetadata(
      { lifecyclePolicy: "general_availability", constraints: { maxWidgets: 5 } },
      "e",
      now,
    );
    f.publish("e", now);
    const report = new FeatureRegistryValidator().validate([f]);
    expect(
      report.issues.some((i) => i.code === "missing_documentation" && i.severity === "warning"),
    ).toBe(true);
    expect(
      report.issues.some((i) => i.code === "invalid_constraint" && i.severity === "warning"),
    ).toBe(true);
    expect(report.valid).toBe(true); // warnings do not fail validity
  });

  it("flags a bundle referencing an unknown feature", () => {
    const bundle = FeatureBundle.create(
      id(),
      { key: "ai.pack", name: "AI Pack", featureKeys: ["ghost"], tenantId: "tenant-1" },
      "e",
      now,
    );
    const report = new FeatureRegistryValidator().validate([feature("ai.tokens")], [bundle]);
    expect(report.issues.some((i) => i.code === "missing_dependency" && i.key === "ai.pack")).toBe(
      true,
    );
  });
});
