import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import { ProductCreateForm } from "./product-create-form";

const createProductAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
vi.mock("@/app/products/actions", () => ({
  createProductAction: (previous: FormState, formData: FormData) =>
    createProductAction(previous, formData),
}));

beforeEach(() => {
  createProductAction.mockReset();
});

function fillRequiredFields(): void {
  fireEvent.change(screen.getByLabelText(en.productCreate.sku), { target: { value: "SKU-1" } });
  fireEvent.change(screen.getByLabelText(en.productCreate.name), {
    target: { value: "Wooden Blocks" },
  });
  fireEvent.change(screen.getByLabelText(en.productCreate.slug), {
    target: { value: "wooden-blocks" },
  });
  fireEvent.change(screen.getByLabelText(en.productCreate.variantSku), {
    target: { value: "SKU-1-STD" },
  });
  fireEvent.change(screen.getByLabelText(en.productCreate.variantPrice), {
    target: { value: "2999" },
  });
  fireEvent.change(screen.getByLabelText(en.productCreate.variantCurrency), {
    target: { value: "USD" },
  });
}

describe("ProductCreateForm", () => {
  it("renders per-field errors the action reports, next to their inputs", async () => {
    createProductAction.mockResolvedValue({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: { sku: "must not be empty" },
    });
    render(<ProductCreateForm t={en} />);

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: en.productCreate.submit }));

    expect(await screen.findByText("must not be empty")).toBeInTheDocument();
    expect(screen.getByLabelText(en.productCreate.sku)).toHaveAttribute("aria-invalid", "true");
  });

  it("disables the submit button while the action is pending", async () => {
    let resolveAction: (value: FormState) => void = () => {};
    createProductAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    render(<ProductCreateForm t={en} />);

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: en.productCreate.submit }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: en.productCreate.submitting })).toBeDisabled(),
    );

    resolveAction({ status: "success" });
  });

  it("starts with exactly one variant row and adds another on 'add variant'", () => {
    render(<ProductCreateForm t={en} />);

    expect(screen.getAllByLabelText(en.productCreate.variantSku)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: en.productCreate.addVariant }));

    expect(screen.getAllByLabelText(en.productCreate.variantSku)).toHaveLength(2);
  });
});
