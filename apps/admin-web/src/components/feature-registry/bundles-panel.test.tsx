import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { BundleOutputDto } from "@/lib/api/feature-registry";
import { BundlesPanel, type BundlesPanelResult } from "./bundles-panel";

function makeBundle(overrides: Partial<BundleOutputDto> = {}): BundleOutputDto {
  return {
    key: "starter-bundle",
    name: "Starter",
    description: "The starter plan bundle",
    status: "active",
    featureKeys: ["checkout.express"],
    groups: ["checkout"],
    ...overrides,
  };
}

describe("BundlesPanel", () => {
  it("renders a row per bundle with its key, status badge, and feature keys", () => {
    const result: BundlesPanelResult = { outcome: "ok", data: [makeBundle()] };

    render(<BundlesPanel result={result} t={en} />);

    expect(screen.getByText("starter-bundle")).toBeInTheDocument();
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("checkout.express")).toBeInTheDocument();
  });

  it('renders "none" for a bundle with no feature keys and no groups', () => {
    const result: BundlesPanelResult = { outcome: "ok", data: [makeBundle({ featureKeys: [], groups: [] })] };

    render(<BundlesPanel result={result} t={en} />);

    expect(screen.getAllByText(en.featureRegistryPage.none).length).toBeGreaterThan(0);
  });

  it("renders the empty state for no bundles, not an error", () => {
    render(<BundlesPanel result={{ outcome: "ok", data: [] }} t={en} />);

    expect(screen.getByText(en.featureRegistryPage.bundlesEmpty)).toBeInTheDocument();
  });

  it("renders an intentional unauthorized state, never demo data", () => {
    render(<BundlesPanel result={{ outcome: "unauthorized" }} t={en} />);

    expect(screen.getByText(en.featureRegistryPage.bundlesUnauthorized)).toBeInTheDocument();
  });

  it("renders an intentional error state, never an empty table", () => {
    render(<BundlesPanel result={{ outcome: "error", message: "boom" }} t={en} />);

    expect(screen.getByText(en.featureRegistryPage.bundlesError)).toBeInTheDocument();
  });
});
