import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RangePicker } from "./range-picker";
import { en } from "@/messages/en";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("RangePicker", () => {
  it("links each range to the page it is on, so the choice lives in that page's URL", () => {
    render(<RangePicker t={en} range="7d" path="/analytics" />);

    const nav = screen.getByRole("navigation", { name: en.header.dateRange });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/analytics?range=today",
      "/analytics?range=yesterday",
      "/analytics?range=7d",
      "/analytics?range=30d",
      "/analytics?range=month",
    ]);
  });

  it("marks only the chosen range as current", () => {
    render(<RangePicker t={en} range="yesterday" path="/" />);

    const current = screen.getAllByRole("link").filter((link) => link.hasAttribute("aria-current"));
    expect(current.map((link) => link.textContent)).toEqual(["Yesterday"]);
  });
});
