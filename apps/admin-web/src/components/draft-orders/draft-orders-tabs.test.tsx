import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { DraftOrdersTabs } from "./draft-orders-tabs";

describe("DraftOrdersTabs", () => {
  it("shows All, Open, Invoice sent and Completed, marking the current one", () => {
    render(<DraftOrdersTabs current="open" q={undefined} t={en} />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "All",
      "Open",
      "Invoice sent",
      "Completed",
    ]);
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
  });

  it("marks All current when no status is chosen", () => {
    render(<DraftOrdersTabs current={undefined} q={undefined} t={en} />);
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the search in every tab's link and never carries a cursor", () => {
    render(<DraftOrdersTabs current={undefined} q="#D3" t={en} />);
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute(
      "href",
      "/draft-orders?q=%23D3",
    );
    expect(screen.getByRole("link", { name: "Completed" })).toHaveAttribute(
      "href",
      "/draft-orders?status=completed&q=%23D3",
    );
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toContain("after=");
    }
  });

  it("is labelled and worded in Egyptian Arabic", () => {
    render(<DraftOrdersTabs current="completed" q={undefined} t={ar} />);
    expect(screen.getByRole("navigation", { name: ar.draftOrders.tabsLabel })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "مكتملة" })).toHaveAttribute("aria-current", "page");
  });
});
