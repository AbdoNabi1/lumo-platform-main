import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FeatureOutputDto, FetchCapabilityGraphResult } from "@/lib/api/feature-registry";
import { CapabilityGraphPanel } from "./capability-graph-panel";

function makeFeature(overrides: Partial<FeatureOutputDto> = {}): FeatureOutputDto {
  return {
    key: "checkout.express",
    name: "Express checkout",
    lifecycle: "active",
    category: "checkout",
    visibility: "public",
    publishedVersion: 3,
    versionCount: 3,
    hasDraft: false,
    replacementKey: null,
    requiredPlans: [],
    requiredPermissions: [],
    requiredCapabilities: [],
    dependencies: [{ featureKey: "checkout.core", minVersion: 1 }],
    groups: [],
    compatibility: {
      compatibleWith: [],
      requires: ["payments.core"],
      conflictsWith: [],
      replaces: [],
      deprecatedBy: "",
      migrationTarget: "",
    },
    ai: {},
    lifecyclePolicy: "general_availability",
    constraints: {},
    cost: {},
    documentation: {},
    analytics: {},
    ...overrides,
  };
}

/**
 * The states the capability graph tab must render distinctly (T3.4): the acyclic summary with a
 * derived edge table (dependency + requires rows), a cycle detected, no edges yet, unauthorized,
 * and a generic fetch error. The edge table is derived from the feature catalog, not from a
 * `nodes`-only backend payload — see `lib/api/feature-registry.ts`'s `deriveCapabilityEdges`.
 */
describe("CapabilityGraphPanel", () => {
  it("renders the acyclic badge and one edge row per dependency and per requires entry", () => {
    const graphResult: FetchCapabilityGraphResult = {
      outcome: "ok",
      data: { nodes: ["checkout.express", "checkout.core", "payments.core"], cycles: [], acyclic: true },
    };

    render(<CapabilityGraphPanel graphResult={graphResult} features={[makeFeature()]} t={en} />);

    expect(screen.getByText(en.featureRegistryPage.graphSummaryAcyclic)).toBeInTheDocument();
    expect(screen.getByText("checkout.core")).toBeInTheDocument();
    expect(screen.getByText("payments.core")).toBeInTheDocument();
    expect(screen.getByText(en.featureRegistryPage.relationshipDependency)).toBeInTheDocument();
    expect(screen.getByText(en.featureRegistryPage.relationshipRequires)).toBeInTheDocument();
  });

  it("renders the cycle-detected badge and the cycle's key chain", () => {
    const graphResult: FetchCapabilityGraphResult = {
      outcome: "ok",
      data: { nodes: ["a", "b"], cycles: [["a", "b", "a"]], acyclic: false },
    };

    render(<CapabilityGraphPanel graphResult={graphResult} features={[]} t={en} />);

    expect(screen.getByText(en.featureRegistryPage.graphSummaryCyclic)).toBeInTheDocument();
    expect(screen.getByText(/a → b → a/)).toBeInTheDocument();
  });

  it("renders the no-edges empty state when the catalog has no dependencies or requirements", () => {
    const graphResult: FetchCapabilityGraphResult = {
      outcome: "ok",
      data: { nodes: ["checkout.core"], cycles: [], acyclic: true },
    };

    render(
      <CapabilityGraphPanel
        graphResult={graphResult}
        features={[makeFeature({ dependencies: [], compatibility: { ...makeFeature().compatibility, requires: [] } })]}
        t={en}
      />,
    );

    expect(screen.getByText(en.featureRegistryPage.graphEdgesEmpty)).toBeInTheDocument();
  });

  it("renders an intentional unauthorized state, never demo data", () => {
    render(<CapabilityGraphPanel graphResult={{ outcome: "unauthorized" }} features={[]} t={en} />);

    expect(screen.getByText(en.featureRegistryPage.graphUnauthorized)).toBeInTheDocument();
  });

  it("renders an intentional error state, never an empty edge table", () => {
    render(
      <CapabilityGraphPanel
        graphResult={{ outcome: "error", message: "boom" }}
        features={[makeFeature()]}
        t={en}
      />,
    );

    expect(screen.getByText(en.featureRegistryPage.graphError)).toBeInTheDocument();
    expect(screen.queryByText("checkout.core")).not.toBeInTheDocument();
  });
});
