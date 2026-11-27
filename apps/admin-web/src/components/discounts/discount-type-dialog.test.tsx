import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { en } from "@/messages/en";
import { DiscountTypeDialog } from "./discount-type-dialog";

describe("DiscountTypeDialog", () => {
  it("offers Shopify's four types, each opening its form", () => {
    render(<DiscountTypeDialog t={en} />);

    fireEvent.click(screen.getByRole("button", { name: en.discounts.create }));

    const dialog = screen.getByRole("dialog", { name: en.discounts.typeDialogTitle });
    const links = within(dialog).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/discounts/new?type=amount_off_products",
      "/discounts/new?type=buy_x_get_y",
      "/discounts/new?type=amount_off_order",
      "/discounts/new?type=free_shipping",
    ]);
    expect(
      within(dialog).getByText(en.discounts.typeDescriptions.free_shipping),
    ).toBeInTheDocument();
  });
});
