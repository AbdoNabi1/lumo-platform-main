import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import { OrderCreateForm } from "./order-create-form";

const placeOrderAction = vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
vi.mock("@/app/orders/actions", () => ({
  placeOrderAction: (previous: FormState, formData: FormData) =>
    placeOrderAction(previous, formData),
}));

beforeEach(() => {
  placeOrderAction.mockReset();
});

function fillRequiredFields(): void {
  fireEvent.change(screen.getByLabelText(en.orderCreate.customerRef), {
    target: { value: "customer-1" },
  });
  fireEvent.change(screen.getByLabelText(en.orderCreate.currency), { target: { value: "USD" } });
  fireEvent.change(screen.getByLabelText(en.orderLineItemForm.productId), {
    target: { value: "product-1" },
  });
  fireEvent.change(screen.getByLabelText(en.orderLineItemForm.name), {
    target: { value: "Wooden Blocks" },
  });
  fireEvent.change(screen.getByLabelText(en.orderLineItemForm.unitPrice), {
    target: { value: "2999" },
  });
  fireEvent.change(screen.getByLabelText(en.orderLineItemForm.quantity), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText(en.orderAddressForm.line1), {
    target: { value: "123 Main St" },
  });
  fireEvent.change(screen.getByLabelText(en.orderAddressForm.city), {
    target: { value: "Springfield" },
  });
  fireEvent.change(screen.getByLabelText(en.orderAddressForm.postalCode), {
    target: { value: "12345" },
  });
  fireEvent.change(screen.getByLabelText(en.orderAddressForm.country), { target: { value: "US" } });
}

describe("OrderCreateForm", () => {
  it("renders per-field errors the action reports, next to their inputs", async () => {
    placeOrderAction.mockResolvedValue({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: { customerRef: "must not be empty" },
    });
    render(<OrderCreateForm t={en} />);

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: en.orderCreate.submit }));

    expect(await screen.findByText("must not be empty")).toBeInTheDocument();
    expect(screen.getByLabelText(en.orderCreate.customerRef)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("disables the submit button while the action is pending", async () => {
    let resolveAction: (value: FormState) => void = () => {};
    placeOrderAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    render(<OrderCreateForm t={en} />);

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: en.orderCreate.submit }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: en.orderCreate.submitting })).toBeDisabled(),
    );

    resolveAction({ status: "success" });
  });

  it("starts with exactly one line item row and adds another on 'add item'", () => {
    render(<OrderCreateForm t={en} />);

    expect(screen.getAllByLabelText(en.orderLineItemForm.productId)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: en.orderLineItemForm.addItem }));

    expect(screen.getAllByLabelText(en.orderLineItemForm.productId)).toHaveLength(2);
  });

  it("renders exactly one address block (shipping only)", () => {
    render(<OrderCreateForm t={en} />);
    expect(screen.getAllByLabelText(en.orderAddressForm.line1)).toHaveLength(1);
  });
});
