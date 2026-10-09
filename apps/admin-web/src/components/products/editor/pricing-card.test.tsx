import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { PricingCard, type PricingInitial } from "./pricing-card";

const t = en.productEditor;

const defaults: PricingInitial = {
  price: "150",
  compareAtPrice: "",
  costPerItem: "",
  currency: "USD",
  taxable: true,
};

function renderCard(overrides: Partial<PricingInitial> = {}) {
  return render(
    <form id="product-editor">
      <PricingCard initial={{ ...defaults, ...overrides }} errors={{}} t={en} locale="en" />
    </form>,
  );
}

function formData(container: HTMLElement): FormData {
  return new FormData(container.querySelector("form")!);
}

const chip = (label: string) =>
  screen.getByRole("button", { name: (name) => name.startsWith(label) });

describe("PricingCard", () => {
  it("computes profit and margin from price and cost", () => {
    renderCard({ costPerItem: "100" });

    expect(screen.getByTestId("profit")).toHaveTextContent("50.00");
    expect(screen.getByTestId("margin")).toHaveTextContent("33.3%");
  });

  it("shows a dash while the cost is blank", () => {
    renderCard();

    expect(screen.getByTestId("profit")).toHaveTextContent("—");
    expect(screen.getByTestId("margin")).toHaveTextContent("—");
  });

  it("updates live as the price changes", () => {
    renderCard({ costPerItem: "100" });

    fireEvent.change(screen.getByLabelText(t.price), { target: { value: "200" } });

    expect(screen.getByTestId("profit")).toHaveTextContent("100.00");
    expect(screen.getByTestId("margin")).toHaveTextContent("50.0%");
  });

  it("shows only the price at first, with the cost, profit and margin behind the cost chip", () => {
    renderCard();

    expect(screen.getByLabelText(t.price)).toBeVisible();
    expect(screen.getByLabelText(t.costPerItem)).not.toBeVisible();
    expect(screen.getByTestId("profit")).not.toBeVisible();

    fireEvent.click(chip(t.costPerItem));
    fireEvent.change(screen.getByLabelText(t.costPerItem), { target: { value: "100" } });

    expect(screen.getByLabelText(t.costPerItem)).toBeVisible();
    expect(screen.getByTestId("profit")).toBeVisible();
    expect(screen.getByTestId("profit")).toHaveTextContent("50.00");
  });

  it("still submits the compare-at price while its chip is closed", () => {
    const { container } = renderCard({ compareAtPrice: "" });

    expect(chip(t.compareAtPrice)).toHaveAttribute("aria-expanded", "false");
    const input = screen.getByLabelText(t.compareAtPrice);
    expect(input).not.toBeVisible();
    expect(input).toHaveAttribute("name", "compareAtPrice");
    expect(input).toHaveAttribute("form", "product-editor");
    expect(formData(container).get("compareAtPrice")).toBe("");

    fireEvent.click(chip(t.compareAtPrice));
    fireEvent.change(input, { target: { value: "200" } });
    fireEvent.click(chip(t.compareAtPrice));

    expect(input).not.toBeVisible();
    expect(formData(container).get("compareAtPrice")).toBe("200");
  });

  it("opens the chips whose field holds a non-default value, and shows each value", () => {
    renderCard({ compareAtPrice: "200", costPerItem: "100", taxable: false });

    expect(chip(t.compareAtPrice)).toHaveAttribute("aria-expanded", "true");
    expect(chip(t.compareAtPrice)).toHaveTextContent("· $200.00");
    expect(chip(t.costPerItem)).toHaveAttribute("aria-expanded", "true");
    expect(chip(t.costPerItem)).toHaveTextContent("· $100.00");
    expect(chip(t.chargeTax)).toHaveAttribute("aria-expanded", "true");
    expect(chip(t.chargeTax)).toHaveTextContent(`· ${t.no}`);
    expect(screen.getByLabelText(t.compareAtPrice)).toBeVisible();
  });

  it("keeps the chips closed for the defaults: no compare-at, no cost, tax charged", () => {
    renderCard();

    expect(chip(t.compareAtPrice)).toHaveAttribute("aria-expanded", "false");
    expect(chip(t.compareAtPrice)).not.toHaveTextContent("·");
    expect(chip(t.costPerItem)).toHaveAttribute("aria-expanded", "false");
    expect(chip(t.chargeTax)).toHaveAttribute("aria-expanded", "false");
    expect(chip(t.chargeTax)).toHaveTextContent(`· ${t.yes}`);
  });

  it("posts taxable as 'on' only while the tax switch is on, and the chip follows it", () => {
    const { container } = renderCard();
    expect(formData(container).get("taxable")).toBe("on");

    fireEvent.click(chip(t.chargeTax));
    fireEvent.click(screen.getByRole("switch", { name: t.chargeTax }));

    expect(formData(container).get("taxable")).toBeNull();
    expect(chip(t.chargeTax)).toHaveTextContent(`· ${t.no}`);
  });

  it("keeps the currency select under the same name, with a visible label", () => {
    const { container } = renderCard({ currency: "EGP" });

    expect(screen.getByLabelText(t.currency)).toHaveAttribute("name", "currency");
    expect(formData(container).get("currency")).toBe("EGP");
  });

  it("marks the price the server rejected", () => {
    render(
      <PricingCard
        initial={defaults}
        errors={{ price: "Enter a valid price" }}
        t={en}
        locale="en"
      />,
    );

    expect(screen.getByLabelText(t.price)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a valid price")).toBeInTheDocument();
  });
});
