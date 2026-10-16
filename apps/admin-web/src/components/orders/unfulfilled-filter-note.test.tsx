import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnfulfilledFilterNote } from "./unfulfilled-filter-note";
import { dictionaryFor } from "@/lib/i18n";
import { en, type Dictionary } from "@/messages/en";

/** The Arabic dictionary, typed as the widened `Dictionary` the components take. */
const ar: Dictionary = dictionaryFor("ar");

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("UnfulfilledFilterNote", () => {
  it("says why only some orders are listed, and links back to all of them", () => {
    render(<UnfulfilledFilterNote t={en} />);

    expect(screen.getByRole("note")).toHaveTextContent("Showing only orders to fulfill");
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/orders");
  });

  it("says it in Arabic", () => {
    render(<UnfulfilledFilterNote t={ar} />);

    expect(screen.getByRole("note")).toHaveTextContent(ar.ordersPage.unfulfilledFilter);
    expect(screen.getByRole("link", { name: ar.ordersPage.clearFilters })).toBeInTheDocument();
  });
});
