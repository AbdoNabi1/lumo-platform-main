import { describe, expect, it } from "vitest";
import { UsageResourceRegistry, usageResourceRegistry } from "./usage-registry";
import { USAGE_RESOURCES } from "./usage-resource";

describe("Usage Registry (billable resources, ADR-0018 §I / ADR-0055)", () => {
  it("seeds a definition for every canonical usage resource", () => {
    for (const resource of USAGE_RESOURCES) {
      expect(usageResourceRegistry.find(resource)).not.toBeNull();
    }
    expect(usageResourceRegistry.list().length).toBe(USAGE_RESOURCES.length);
  });

  it("resolves a billable resource with its unit and category", () => {
    const res = usageResourceRegistry.resolve("AI_TOKEN");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.unit).toBe("tokens");
      expect(res.value.category).toBe("ai");
      expect(res.value.billable).toBe(true);
    }
  });

  it("rejects an unregistered resource (fail-closed)", () => {
    const res = usageResourceRegistry.resolve("NOT_A_RESOURCE");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("NOT_FOUND");
  });

  it("exposes the billable subset", () => {
    const billable = usageResourceRegistry.billable().map((d) => d.resource);
    expect(billable).toContain("ORDER");
    expect(billable).toContain("PRODUCT");
    expect(billable).not.toContain("RECOMMENDATION"); // seeded non-billable
  });

  it("supports additive registration and re-versioning of a resource definition", () => {
    const registry = new UsageResourceRegistry();
    const updated = registry.register({
      resource: "AI_TOKEN",
      metricType: "tokens",
      unit: "tokens",
      category: "ai",
      billable: true,
      description: "updated",
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.value.version).toBe(2);
    expect(registry.find("AI_TOKEN")?.description).toBe("updated");
  });

  it("every resource declares a metric type (P1.1.1 §4)", () => {
    for (const def of usageResourceRegistry.list()) {
      expect(def.metricType.length).toBeGreaterThan(0);
    }
    expect(usageResourceRegistry.find("AI_TOKEN")?.metricType).toBe("tokens");
    expect(usageResourceRegistry.find("STORAGE")?.metricType).toBe("storage");
    expect(usageResourceRegistry.find("ORDER")?.metricType).toBe("count");
  });
});
