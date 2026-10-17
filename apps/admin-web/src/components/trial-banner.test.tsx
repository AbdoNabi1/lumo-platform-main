import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { TrialBanner } from "./trial-banner";

afterEach(cleanup);

describe("TrialBanner", () => {
  it("renders nothing when there is no banner", () => {
    const { container } = render(
      <TrialBanner banner={null} trialDaysLeft={null} t={en} locale="en" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a trial-ending banner with no day count", () => {
    const { container } = render(
      <TrialBanner banner="trial-ending" trialDaysLeft={null} t={en} locale="en" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says how many days are left and links to billing", () => {
    render(<TrialBanner banner="trial-ending" trialDaysLeft={3} t={en} locale="en" />);
    const link = screen.getByRole("link", {
      name: "Your free trial ends in 3 days — choose a plan",
    });
    expect(link).toHaveAttribute("href", "/settings/billing");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("uses the singular for the last day", () => {
    render(<TrialBanner banner="trial-ending" trialDaysLeft={1} t={en} locale="en" />);
    expect(
      screen.getByRole("link", { name: "Your free trial ends in 1 day — choose a plan" }),
    ).toBeInTheDocument();
  });

  it("flags an overdue payment as destructive and links to billing", () => {
    render(<TrialBanner banner="past-due" trialDaysLeft={null} t={en} locale="en" />);
    const link = screen.getByRole("link", {
      name: "Your payment is overdue — pay now to keep your store open",
    });
    expect(link).toHaveAttribute("href", "/settings/billing");
    expect(screen.getByRole("alert").className).toContain("destructive");
  });

  it("renders in Arabic", () => {
    render(<TrialBanner banner="trial-ending" trialDaysLeft={3} t={ar} locale="ar" />);
    const link = screen.getByRole("link", { name: /^تجربتك المجانية/ });
    expect(link).toHaveAttribute("href", "/settings/billing");
    expect(link.textContent).toMatch(/[3٣]/);
    expect(link.textContent).not.toContain("{");
  });

  it("renders the Arabic overdue notice", () => {
    render(<TrialBanner banner="past-due" trialDaysLeft={null} t={ar} locale="ar" />);
    expect(screen.getByRole("link", { name: ar.trialBanner.pastDue })).toBeInTheDocument();
  });

  it("keeps both locales in step", () => {
    expect(Object.keys(ar.trialBanner).sort()).toEqual(Object.keys(en.trialBanner).sort());
  });
});
