import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrdersViewTabs } from "./orders-view-tabs";

describe("OrdersViewTabs (order operations Part 1)", () => {
  it("shows Shopify's tabs in order, marks the current one, and keeps the search in each link", () => {
    render(<OrdersViewTabs current="unpaid" q="mona" status={undefined} tags={[]} t={en} />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "All",
      "Unfulfilled",
      "Unpaid",
      "Open",
      "Archived",
    ]);
    expect(screen.getByRole("link", { name: "Unpaid" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Archived" })).toHaveAttribute(
      "href",
      "/orders?view=archived&q=mona",
    );
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/orders?q=mona");
  });

  it("is in Arabic", () => {
    render(<OrdersViewTabs current="all" q={undefined} status={undefined} tags={[]} t={ar} />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "الكل",
      "غير منفذة",
      "غير مدفوعة",
      "مفتوحة",
      "مؤرشفة",
    ]);
  });
});
