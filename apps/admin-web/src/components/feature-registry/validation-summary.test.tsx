import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FetchRegistryValidationResult } from "@/lib/api/feature-registry";
import { ValidationSummary } from "./validation-summary";

/**
 * The states the validation summary must render distinctly (T3.4): a passing report, a failing
 * one with its issues listed, unauthorized, and a generic fetch error — never an empty table on
 * failure (T3.4 brief).
 */
describe("ValidationSummary", () => {
  it("renders the pass badge and the no-issues message for a valid registry", () => {
    const result: FetchRegistryValidationResult = { outcome: "ok", data: { valid: true, issues: [] } };

    render(<ValidationSummary result={result} t={en} />);

    expect(screen.getByText(en.featureRegistryPage.validationPass)).toBeInTheDocument();
    expect(screen.getByText(en.featureRegistryPage.validationIssuesEmpty)).toBeInTheDocument();
  });

  it("renders the fail badge and the issues table for an invalid registry", () => {
    const result: FetchRegistryValidationResult = {
      outcome: "ok",
      data: {
        valid: false,
        issues: [
          {
            code: "MISSING_DEPENDENCY",
            severity: "error",
            key: "checkout.express",
            message: "depends on an unknown feature",
          },
          {
            code: "NO_DOCUMENTATION",
            severity: "warning",
            key: "checkout.express",
            message: "no documentation url set",
          },
        ],
      },
    };

    render(<ValidationSummary result={result} t={en} />);

    expect(screen.getByText(en.featureRegistryPage.validationFail)).toBeInTheDocument();
    expect(screen.getByText("MISSING_DEPENDENCY")).toBeInTheDocument();
    expect(screen.getByText("depends on an unknown feature")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.getByText("warning")).toBeInTheDocument();
  });

  it("renders an intentional unauthorized state, never demo data", () => {
    render(<ValidationSummary result={{ outcome: "unauthorized" }} t={en} />);

    expect(screen.getByText(en.featureRegistryPage.validationUnauthorized)).toBeInTheDocument();
  });

  it("renders an intentional error state, never an empty pass/fail summary", () => {
    render(<ValidationSummary result={{ outcome: "error", message: "boom" }} t={en} />);

    expect(screen.getByText(en.featureRegistryPage.validationError)).toBeInTheDocument();
    expect(screen.queryByText(en.featureRegistryPage.validationPass)).not.toBeInTheDocument();
    expect(screen.queryByText(en.featureRegistryPage.validationFail)).not.toBeInTheDocument();
  });
});
