import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FetchIdentityTimelineResult } from "@/lib/api/customer-360";
import { CustomerIdentityTimelineCard } from "./customer-identity-timeline-card";

describe("CustomerIdentityTimelineCard", () => {
  it("renders observed, merged, and split entries with their counterpart identifiers", () => {
    const result: FetchIdentityTimelineResult = {
      outcome: "ok",
      data: {
        entries: [
          {
            kind: "observed",
            occurredAt: "2026-07-01T00:00:00.000Z",
            counterpartType: "email_hash",
            counterpartValue: "hash-1",
            confidence: "deterministic",
            source: "checkout",
          },
          {
            kind: "merged",
            occurredAt: "2026-07-02T00:00:00.000Z",
            decisionId: "decision-1",
            counterpartType: "visitor_id",
            counterpartValue: "visitor-1",
            reason: "matched loyalty account",
            actor: "staff-1",
          },
          {
            kind: "split",
            occurredAt: "2026-07-03T00:00:00.000Z",
            decisionId: "decision-2",
            counterpartType: "device_id",
            counterpartValue: "device-1",
            reason: "false positive",
            actor: "staff-2",
          },
        ],
      },
    };

    render(<CustomerIdentityTimelineCard result={result} t={en} locale="en" />);

    expect(screen.getByText(en.customerDetail.identityTimelineObserved)).toBeInTheDocument();
    expect(screen.getByText(en.customerDetail.identityTimelineMerged)).toBeInTheDocument();
    expect(screen.getByText(en.customerDetail.identityTimelineSplit)).toBeInTheDocument();
    expect(screen.getByText("email_hash: hash-1")).toBeInTheDocument();
    expect(screen.getByText("visitor_id: visitor-1")).toBeInTheDocument();
    expect(screen.getByText("device_id: device-1")).toBeInTheDocument();
  });

  it("renders the normal empty state when there is no identity history yet", () => {
    const result: FetchIdentityTimelineResult = { outcome: "ok", data: { entries: [] } };

    render(<CustomerIdentityTimelineCard result={result} t={en} locale="en" />);

    expect(screen.getByText(en.customerDetail.identityTimelineEmpty)).toBeInTheDocument();
  });

  it("renders an intentional unauthorized state, never demo data", () => {
    render(
      <CustomerIdentityTimelineCard result={{ outcome: "unauthorized" }} t={en} locale="en" />,
    );

    expect(screen.getByText(en.customerDetail.identityTimelineUnauthorized)).toBeInTheDocument();
  });

  it("renders an intentional error state, never demo data", () => {
    render(
      <CustomerIdentityTimelineCard
        result={{ outcome: "error", message: "boom" }}
        t={en}
        locale="en"
      />,
    );

    expect(screen.getByText(en.customerDetail.identityTimelineUnavailable)).toBeInTheDocument();
  });
});
