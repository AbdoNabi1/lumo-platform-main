import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LEAD_STATUSES } from "@/lib/leads/lead-status";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { LeadStatusBadge } from "./lead-status-badge";

beforeEach(() => {
  expect.hasAssertions();
});

const VARIANT_CLASS: Record<string, string> = {
  new: "bg-secondary", // neutral
  contacted: "bg-warning-subtle", // warning
  qualified: "bg-success-subtle", // success
  converted: "bg-success-subtle", // success
  rejected: "border-border-strong", // outline
  spam: "bg-destructive-subtle", // destructive
};

describe("LeadStatusBadge", () => {
  it.each(LEAD_STATUSES)(
    "%s renders its variant and its own text (never colour alone)",
    (status) => {
      render(<LeadStatusBadge status={status} t={en} />);
      const badge = screen.getByText(en.leadStatus[status]);
      expect(badge).toHaveClass(VARIANT_CLASS[status] ?? "missing");
    },
  );

  it("covers every status in both languages", () => {
    for (const status of LEAD_STATUSES) {
      expect(en.leadStatus[status].length).toBeGreaterThan(0);
      expect(ar.leadStatus[status].length).toBeGreaterThan(0);
    }
    expect(Object.keys(en.leadStatus).sort()).toEqual([...LEAD_STATUSES].sort());
    expect(Object.keys(ar.leadStatus).sort()).toEqual([...LEAD_STATUSES].sort());
  });

  it("falls back to the raw value, neutral, for a status this UI does not know", () => {
    render(<LeadStatusBadge status="archived" t={en} />);
    expect(screen.getByText("archived")).toHaveClass("bg-secondary");
  });

  it("shows the Arabic copy from the plan", () => {
    expect(LEAD_STATUSES.map((status) => ar.leadStatus[status])).toEqual([
      "جديد",
      "اتواصلنا",
      "مؤهل",
      "اتحول لعميل",
      "مرفوض",
      "سبام",
    ]);
  });
});
