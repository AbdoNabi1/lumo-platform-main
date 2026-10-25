import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { AbandonedCheckoutsFilters } from "./abandoned-checkouts-filters";

describe("AbandonedCheckoutsFilters", () => {
  it("is a GET search form that keeps the current search and filter", () => {
    render(<AbandonedCheckoutsFilters q="mona" recovery="recovered" t={en} />);
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/abandoned-checkouts");
    expect(screen.getByRole("searchbox", { name: en.abandonedCheckouts.searchLabel })).toHaveValue(
      "mona",
    );
    expect(
      screen.getByRole("combobox", { name: en.abandonedCheckouts.recoveryFilterLabel }),
    ).toHaveValue("recovered");
  });
});
