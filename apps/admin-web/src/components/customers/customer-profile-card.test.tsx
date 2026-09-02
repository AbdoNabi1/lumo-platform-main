import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FetchCustomerProfileResult } from "@/lib/api/customer-360";
import { CustomerProfileCard } from "./customer-profile-card";

/**
 * The states this card must render distinctly (T3.3): a merged profile, the normal "nothing
 * merged yet" empty state (a `null` profile is not an error — `lib/api/customer-360.ts`'s doc
 * comment), unauthorized, and a generic fetch error — never demo data for any of them.
 */
describe("CustomerProfileCard", () => {
  it("renders the merged profile's confidence, completeness, and merged-from identifiers", () => {
    const result: FetchCustomerProfileResult = {
      outcome: "ok",
      data: {
        profile: {
          identifierType: "customer_id",
          identifierValue: "customer-1",
          fields: {},
          version: 2,
          updatedAt: "2026-07-05T00:00:00.000Z",
        },
        mergedFrom: [{ type: "customer_id", value: "customer-1" }],
        completeness: 0.5,
        confidence: { verified: 1, inferred: 1, overall: "inferred" },
        freshness: {},
        sources: {},
      },
    };

    render(<CustomerProfileCard result={result} t={en} locale="en" />);

    expect(screen.getByText(en.customerDetail.unifiedProfileConfidenceInferred)).toBeInTheDocument();
    expect(screen.getByText("50% complete")).toBeInTheDocument();
    expect(screen.getByText("customer_id: customer-1")).toBeInTheDocument();
    expect(screen.getByText(en.customerDetail.unifiedProfileNoFields)).toBeInTheDocument();
  });

  it("renders a field name/value list when the merged profile has fields", () => {
    const result: FetchCustomerProfileResult = {
      outcome: "ok",
      data: {
        profile: {
          identifierType: "customer_id",
          identifierValue: "customer-1",
          fields: { fullName: "Amina Haddad" },
          version: 1,
          updatedAt: "2026-07-05T00:00:00.000Z",
        },
        mergedFrom: [{ type: "customer_id", value: "customer-1" }],
        completeness: null,
        confidence: null,
        freshness: {},
        sources: {},
      },
    };

    render(<CustomerProfileCard result={result} t={en} locale="en" />);

    expect(screen.getByText("fullName")).toBeInTheDocument();
    expect(screen.getByText("Amina Haddad")).toBeInTheDocument();
  });

  it("renders the normal empty state when no profile has merged yet, not an error", () => {
    const result: FetchCustomerProfileResult = {
      outcome: "ok",
      data: {
        profile: null,
        mergedFrom: [],
        completeness: null,
        confidence: null,
        freshness: null,
        sources: null,
      },
    };

    render(<CustomerProfileCard result={result} t={en} locale="en" />);

    expect(screen.getByText(en.customerDetail.unifiedProfileEmpty)).toBeInTheDocument();
    expect(screen.queryByText(en.customerDetail.unifiedProfileUnavailable)).not.toBeInTheDocument();
  });

  it("renders the not_found outcome the same as the empty state", () => {
    render(<CustomerProfileCard result={{ outcome: "not_found" }} t={en} locale="en" />);

    expect(screen.getByText(en.customerDetail.unifiedProfileEmpty)).toBeInTheDocument();
  });

  it("renders an intentional unauthorized state, never demo data", () => {
    render(<CustomerProfileCard result={{ outcome: "unauthorized" }} t={en} locale="en" />);

    expect(screen.getByText(en.customerDetail.unifiedProfileUnauthorized)).toBeInTheDocument();
  });

  it("renders an intentional error state, never demo data", () => {
    render(
      <CustomerProfileCard
        result={{ outcome: "error", message: "boom" }}
        t={en}
        locale="en"
      />,
    );

    expect(screen.getByText(en.customerDetail.unifiedProfileUnavailable)).toBeInTheDocument();
  });
});
