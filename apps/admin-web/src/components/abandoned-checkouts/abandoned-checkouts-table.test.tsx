import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { AbandonedCheckoutListItemDto } from "@/lib/api/abandoned-checkouts";
import { formatCurrency } from "@/lib/format";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { AbandonedCheckoutsTable } from "./abandoned-checkouts-table";

function row(overrides: Partial<AbandonedCheckoutListItemDto> = {}): AbandonedCheckoutListItemDto {
  return {
    id: "01920000-0000-7000-8000-00000000abcd",
    reference: "#0000ABCD",
    createdAt: "2026-10-18T09:00:00.000Z",
    lastActivityAt: "2026-10-18T09:20:00.000Z",
    customerName: "Mona Ali",
    email: "sara@example.com",
    phone: "01001234567",
    region: "EG-C",
    country: "EG",
    itemCount: 2,
    totalMinor: 50000,
    currency: "EGP",
    recoveryStatus: "not_recovered",
    recoveredOrder: null,
    lastLinkIssuedAt: null,
    ...overrides,
  };
}

describe("AbandonedCheckoutsTable (Shopify's columns)", () => {
  it("shows the columns in Shopify's order", () => {
    render(<AbandonedCheckoutsTable checkouts={[row()]} t={en} locale="en" />);
    const c = en.abandonedCheckouts.columns;
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      c.checkout,
      c.date,
      c.placedBy,
      c.region,
      c.recoveryLink,
      c.recoveryStatus,
      c.total,
    ]);
  });

  it("a not-recovered, never-shared row", () => {
    render(<AbandonedCheckoutsTable checkouts={[row()]} t={en} locale="en" />);
    expect(screen.getByRole("link", { name: "#0000ABCD" })).toHaveAttribute(
      "href",
      "/abandoned-checkouts/01920000-0000-7000-8000-00000000abcd",
    );
    expect(screen.getByText("Mona Ali")).toHaveAttribute("dir", "auto");
    expect(screen.getByText(en.abandonedCheckouts.notShared)).toBeInTheDocument();
    expect(screen.getByText(en.abandonedCheckouts.notRecovered)).toBeInTheDocument();
    // Intl puts a no-break space after the code; Testing Library normalises the DOM text's, so do the same.
    expect(
      screen.getByText(formatCurrency("en", 50000, "EGP").replace(/\s+/g, " ")),
    ).toBeInTheDocument();
  });

  it("a shared and recovered row links its order", () => {
    render(
      <AbandonedCheckoutsTable
        checkouts={[
          row({
            customerName: null,
            lastLinkIssuedAt: "2026-10-18T12:00:00.000Z",
            recoveryStatus: "recovered",
            recoveredOrder: { id: "order-9", orderNumber: "1007" },
          }),
        ]}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText("sara@example.com")).toBeInTheDocument();
    expect(screen.getByText("Shared Oct 18")).toBeInTheDocument();
    const recovered = screen.getByRole("link", { name: en.abandonedCheckouts.recovered });
    expect(recovered).toHaveAttribute("href", "/orders/order-9");
  });

  it("renders in Arabic with the Arabic labels", () => {
    render(
      <AbandonedCheckoutsTable
        checkouts={[row({ lastLinkIssuedAt: "2026-10-18T12:00:00.000Z" })]}
        t={ar}
        locale="ar"
      />,
    );
    expect(screen.getAllByRole("columnheader")[0]).toHaveTextContent(
      ar.abandonedCheckouts.columns.checkout,
    );
    expect(screen.getByText(ar.abandonedCheckouts.notRecovered)).toBeInTheDocument();
    expect(screen.queryByText(/\{date\}/)).toBeNull();
  });

  it("an anonymous row without a region still renders", () => {
    render(
      <AbandonedCheckoutsTable
        checkouts={[row({ customerName: null, email: null, phone: null, region: null })]}
        t={en}
        locale="en"
      />,
    );
    const cells = within(screen.getAllByRole("row")[1] as HTMLElement).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent(en.abandonedCheckouts.unknownCustomer);
    expect(cells[3]).toHaveTextContent(en.abandonedCheckouts.noRegion);
  });
});
