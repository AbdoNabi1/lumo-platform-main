import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { ResolveFeatureResult, ResolvedFeatureDto } from "@/lib/api/feature-registry";
import { ResolvePanel } from "./resolve-panel";

function makeResolvedFeature(overrides: Partial<ResolvedFeatureDto> = {}): ResolvedFeatureDto {
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
    requiredPlans: ["pro"],
    requiredPermissions: [],
    requiredCapabilities: [],
    dependencies: [{ featureKey: "checkout.core", minVersion: 1 }],
    groups: ["checkout"],
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
    available: true,
    ...overrides,
  };
}

/**
 * The states the resolve panel must render distinctly (T3.4): an available feature, an
 * unavailable one, "no feature under this key" (a normal outcome, not an error), unauthorized,
 * and a generic fetch error — never demo data for any of them.
 */
describe("ResolvePanel", () => {
  it("renders the available badge, requirements, and dependencies for a resolved feature", () => {
    const result: ResolveFeatureResult = { outcome: "ok", data: makeResolvedFeature() };

    render(<ResolvePanel result={result} keyParam="checkout.express" t={en} />);

    expect(screen.getByText(en.featureRegistryPage.resolveAvailable)).toBeInTheDocument();
    expect(screen.getByText("pro")).toBeInTheDocument();
    expect(screen.getByText("checkout.core")).toBeInTheDocument();
    expect(
      screen.getByText(en.featureRegistryPage.resolveTitle.replace("{key}", "checkout.express")),
    ).toBeInTheDocument();
  });

  it("renders the unavailable badge for a draft/removed feature", () => {
    const result: ResolveFeatureResult = {
      outcome: "ok",
      data: makeResolvedFeature({ available: false, lifecycle: "draft" }),
    };

    render(<ResolvePanel result={result} keyParam="checkout.express" t={en} />);

    expect(screen.getByText(en.featureRegistryPage.resolveUnavailable)).toBeInTheDocument();
  });

  it('renders "none" for empty requirement lists', () => {
    const result: ResolveFeatureResult = {
      outcome: "ok",
      data: makeResolvedFeature({ requiredPlans: [], dependencies: [] }),
    };

    render(<ResolvePanel result={result} keyParam="checkout.express" t={en} />);

    expect(screen.getAllByText(en.featureRegistryPage.none).length).toBeGreaterThan(0);
  });

  it("renders the not_found outcome as a normal state, not an error", () => {
    render(
      <ResolvePanel result={{ outcome: "not_found" }} keyParam="unknown.feature" t={en} />,
    );

    expect(screen.getByText(en.featureRegistryPage.resolveNotFound)).toBeInTheDocument();
  });

  it("renders an intentional unauthorized state, never demo data", () => {
    render(<ResolvePanel result={{ outcome: "unauthorized" }} keyParam="checkout.express" t={en} />);

    expect(screen.getByText(en.featureRegistryPage.resolveUnauthorized)).toBeInTheDocument();
  });

  it("renders an intentional error state, never demo data", () => {
    render(
      <ResolvePanel
        result={{ outcome: "error", message: "boom" }}
        keyParam="checkout.express"
        t={en}
      />,
    );

    expect(screen.getByText(en.featureRegistryPage.resolveError)).toBeInTheDocument();
  });
});
