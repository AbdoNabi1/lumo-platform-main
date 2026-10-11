import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { ShippingCard } from "./shipping-card";

const t = en.productEditor;

function renderCard(
  requiresShipping: boolean,
  weightGrams: number | null = null,
  weightUnit: "kg" | "g" | "lb" | "oz" = "kg",
) {
  return render(
    <form id="product-editor">
      <ShippingCard
        requiresShipping={requiresShipping}
        weightGrams={weightGrams}
        weightUnit={weightUnit}
        errors={{}}
        t={en}
      />
    </form>,
  );
}

const formData = (container: HTMLElement) => new FormData(container.querySelector("form")!);

describe("ShippingCard", () => {
  it("has the physical-product switch in its header and shows the weight while it is on", () => {
    const { container } = renderCard(true, 1500);

    const physical = screen.getByRole("switch", { name: t.physicalProduct });
    expect(physical).toBeChecked();
    expect(physical).toHaveAttribute("name", "requiresShipping");
    expect(physical).toHaveAttribute("form", "product-editor");
    expect(screen.getByLabelText(`${t.weight} (${t.kilograms})`)).toBeVisible();
    expect(screen.getByLabelText(`${t.weight} (${t.kilograms})`)).toHaveValue("1.5");
    expect(screen.queryByLabelText(t.weightUnit)).not.toBeInTheDocument();
    expect(formData(container).get("weightUnit")).toBe("kg");
    expect(screen.queryByText(t.notPhysicalHint)).not.toBeInTheDocument();
    expect(formData(container).get("requiresShipping")).toBe("on");
  });

  it("explains itself and hides the weight, but keeps it in the form, when switched off", () => {
    const { container } = renderCard(true, 250, "g");
    const weight = `${t.weight} (${t.grams})`;

    fireEvent.click(screen.getByRole("switch", { name: t.physicalProduct }));

    expect(screen.getByText(t.notPhysicalHint)).toBeInTheDocument();
    expect(screen.getByLabelText(weight)).not.toBeVisible();
    expect(formData(container).get("requiresShipping")).toBeNull();
    expect(formData(container).get("weight")).toBe("250");
    expect(formData(container).get("weightUnit")).toBe("g");

    fireEvent.click(screen.getByRole("switch", { name: t.physicalProduct }));
    expect(screen.getByLabelText(weight)).toBeVisible();
    expect(screen.queryByText(t.notPhysicalHint)).not.toBeInTheDocument();
  });

  it("shows a stored weight in the store's unit and posts that unit, whatever the unit", () => {
    const { container } = renderCard(true, 454, "lb");

    expect(screen.getByLabelText(`${t.weight} (${t.pounds})`)).toHaveValue("1.001");
    expect(formData(container).get("weightUnit")).toBe("lb");
  });

  it("shows no weight for a product without one", () => {
    renderCard(true, null, "oz");

    expect(screen.getByLabelText(`${t.weight} (${t.ounces})`)).toHaveValue("");
  });

  it("starts a non-physical product switched off, with the hint showing", () => {
    renderCard(false);

    expect(screen.getByRole("switch", { name: t.physicalProduct })).not.toBeChecked();
    expect(screen.getByText(t.notPhysicalHint)).toBeInTheDocument();
  });
});
