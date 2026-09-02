import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import { OrderFromCheckoutForm } from "./order-from-checkout-form";

const createOrderFromCheckoutAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
vi.mock("@/app/orders/actions", () => ({
  createOrderFromCheckoutAction: (previous: FormState, formData: FormData) =>
    createOrderFromCheckoutAction(previous, formData),
}));

beforeEach(() => {
  createOrderFromCheckoutAction.mockReset();
});

describe("OrderFromCheckoutForm", () => {
  it("renders both billing and shipping address blocks", () => {
    render(<OrderFromCheckoutForm t={en} />);
    expect(screen.getAllByLabelText(en.orderAddressForm.line1)).toHaveLength(2);
    expect(screen.getByText(en.orderFromCheckout.billingAddress)).toBeInTheDocument();
    expect(screen.getByText(en.orderFromCheckout.shippingAddress)).toBeInTheDocument();
  });

  it("renders a checkoutRef field alongside customerRef and currency", () => {
    render(<OrderFromCheckoutForm t={en} />);
    expect(screen.getByLabelText(en.orderFromCheckout.checkoutRef)).toBeInTheDocument();
    expect(screen.getByLabelText(en.orderFromCheckout.customerRef)).toBeInTheDocument();
    expect(screen.getByLabelText(en.orderFromCheckout.currency)).toBeInTheDocument();
  });

  it("disables the submit button while the action is pending", async () => {
    let resolveAction: (value: FormState) => void = () => {};
    createOrderFromCheckoutAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    render(<OrderFromCheckoutForm t={en} />);

    fireEvent.click(screen.getByRole("button", { name: en.orderFromCheckout.submit }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: en.orderFromCheckout.submitting }),
      ).toBeDisabled(),
    );

    resolveAction({ status: "success" });
  });
});
