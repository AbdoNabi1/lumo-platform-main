import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FeatureOutputDto } from "@/lib/api/feature-registry";
import { FeaturesPanel, type FeaturesPanelResult } from "./features-panel";

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
    dependencies: [],
    groups: ["checkout"],
    compatibility: {
      compatibleWith: [],
      requires: [],
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

describe("FeaturesPanel", () => {
  it("renders a row per feature with its key, lifecycle badge, and groups", () => {
    const result: FeaturesPanelResult = { outcome: "ok", data: [makeFeature()] };

    render(<FeaturesPanel result={result} t={en} />);

    expect(screen.getByText("checkout.express")).toBeInTheDocument();
    expect(screen.getByText("Express checkout")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getAllByText("checkout").length).toBe(2);
  });

  it('renders "none" for a feature with no groups and no published version', () => {
    const result: FeaturesPanelResult = {
      outcome: "ok",
      data: [makeFeature({ groups: [], publishedVersion: null })],
    };

    render(<FeaturesPanel result={result} t={en} />);

    expect(screen.getAllByText(en.featureRegistryPage.none).length).toBeGreaterThan(0);
  });

  it("renders the empty state for an empty catalog, not an error", () => {
    render(<FeaturesPanel result={{ outcome: "ok", data: [] }} t={en} />);

    expect(screen.getByText(en.featureRegistryPage.featuresEmpty)).toBeInTheDocument();
  });

  it("renders an intentional unauthorized state, never demo data", () => {
    render(<FeaturesPanel result={{ outcome: "unauthorized" }} t={en} />);

    expect(screen.getByText(en.featureRegistryPage.featuresUnauthorized)).toBeInTheDocument();
  });

  it("renders an intentional error state, never an empty table", () => {
    render(<FeaturesPanel result={{ outcome: "error", message: "boom" }} t={en} />);

    expect(screen.getByText(en.featureRegistryPage.featuresError)).toBeInTheDocument();
  });
});
