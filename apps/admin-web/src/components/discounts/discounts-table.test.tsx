import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { DiscountDto } from "@/lib/api/discounts";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import { DiscountsTable } from "./discounts-table";

const sale10: DiscountDto = {
  id: "promo-1",
  type: "amount_off_order",
  method: "code",
  title: "SALE10",
  code: "SALE10",
  status: "active",
  value: { kind: "percentage", amount: 10 },
  appliesTo: null,
  appliesOncePerOrder: false,
  buys: null,
  gets: null,
  maxUsesPerOrder: null,
  countries: null,
  maxShippingRateMinor: null,
  minimumRequirement: { kind: "none" },
  customerEligibility: { kind: "all" },
  usageLimit: null,
  oncePerCustomer: false,
  combinesWith: { product: true, order: false, shipping: false },
  startsAt: "2026-10-16T10:00:00.000Z",
  endsAt: null,
  usageCount: 3,
};

const summer: DiscountDto = {
  ...sale10,
  id: "promo-2",
  type: "free_shipping",
  method: "automatic",
  title: "Summer shipping",
  code: null,
  status: "scheduled",
  value: null,
  combinesWith: { product: false, order: false, shipping: false },
  usageCount: 0,
};

function renderTable(t: Dictionary = en, locale: "en" | "ar" = "en") {
  return render(
    <DiscountsTable items={[sale10, summer]} t={t} locale={locale} currency="EGP" timeZone="UTC" />,
  );
}

describe("DiscountsTable", () => {
  it("has Shopify's columns", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual([
      en.discounts.columns.title,
      en.discounts.columns.status,
      en.discounts.columns.method,
      en.discounts.columns.type,
      en.discounts.columns.combinations,
      en.discounts.columns.used,
    ]);
  });

  it("shows the code or title with its summary, linking to the discount", () => {
    renderTable();
    const [, first, second] = screen.getAllByRole("row");
    expect(within(first!).getByRole("link", { name: "SALE10" })).toHaveAttribute(
      "href",
      "/discounts/promo-1",
    );
    expect(within(first!).getByText("10% off entire order")).toBeInTheDocument();
    expect(within(first!).getByText(en.discounts.status.active)).toBeInTheDocument();
    expect(within(first!).getByText(en.discounts.methods.code)).toBeInTheDocument();
    expect(within(first!).getByText(en.discounts.types.amount_off_order)).toBeInTheDocument();
    expect(within(first!).getByText("Product")).toBeInTheDocument();
    expect(within(first!).getByText("3")).toBeInTheDocument();

    expect(within(second!).getByRole("link", { name: "Summer shipping" })).toBeInTheDocument();
    expect(within(second!).getByText(en.discounts.methods.automatic)).toBeInTheDocument();
    expect(within(second!).getByText(en.discounts.combinesNone)).toBeInTheDocument();
  });

  it("speaks Arabic", () => {
    renderTable(ar, "ar");
    expect(screen.getByText(ar.discounts.types.free_shipping)).toBeInTheDocument();
    expect(screen.getByText(ar.discounts.status.scheduled)).toBeInTheDocument();
  });
});
