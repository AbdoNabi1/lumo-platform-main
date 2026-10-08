import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { PricingCard } from "./pricing-card";

const t = en.productEditor;

function renderCard(price: string, cost: string) {
  return render(
    <PricingCard
      initial={{
        price,
        compareAtPrice: "",
        costPerItem: cost,
        currency: "USD",
        taxable: true,
      }}
      errors={{}}
      t={en}
      locale="en"
    />,
  );
}

describe("PricingCard", () => {
  it("computes profit and margin from price and cost", () => {
    renderCard("150", "100");

    expect(screen.getByTestId("profit")).toHaveTextContent("50.00");
    expect(screen.getByTestId("margin")).toHaveTextContent("33.3%");
  });

  it("shows a dash while the cost is blank", () => {
    renderCard("150", "");

    expect(screen.getByTestId("profit")).toHaveTextContent("—");
    expect(screen.getByTestId("margin")).toHaveTextContent("—");
  });

  it("updates live as the price changes", () => {
    renderCard("150", "100");

    fireEvent.change(screen.getByLabelText(t.price), { target: { value: "200" } });

    expect(screen.getByTestId("profit")).toHaveTextContent("100.00");
    expect(screen.getByTestId("margin")).toHaveTextContent("50.0%");
  });
});
