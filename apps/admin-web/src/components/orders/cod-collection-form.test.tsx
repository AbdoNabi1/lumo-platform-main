import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import { CodCollectionForm } from "./cod-collection-form";

const confirmCodCollectionAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
vi.mock("@/app/orders/actions", () => ({
  confirmCodCollectionAction: (previous: FormState, formData: FormData) =>
    confirmCodCollectionAction(previous, formData),
}));

beforeEach(() => {
  confirmCodCollectionAction.mockReset().mockResolvedValue({ status: "success" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function renderForm() {
  return render(
    <CodCollectionForm
      orderId="order-1"
      paymentIntentId="intent-1"
      confirmMessage="Confirm you received EGP 450.00 in cash?"
      t={en}
    />,
  );
}

describe("CodCollectionForm (Plan 3A)", () => {
  it("shows the Mark as paid button", () => {
    renderForm();

    expect(screen.getByRole("button", { name: en.orderPage.markAsPaid })).toBeInTheDocument();
  });

  it("asks first, with the amount in the question, and collects once confirmed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: en.orderPage.markAsPaid }));

    expect(confirm).toHaveBeenCalledWith("Confirm you received EGP 450.00 in cash?");
    await waitFor(() => expect(confirmCodCollectionAction).toHaveBeenCalledTimes(1));
    const call = confirmCodCollectionAction.mock.calls[0];
    expect(call?.[1].get("orderId")).toBe("order-1");
    expect(call?.[1].get("paymentIntentId")).toBe("intent-1");
  });

  it("collects nothing when the question is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: en.orderPage.markAsPaid }));

    expect(confirmCodCollectionAction).not.toHaveBeenCalled();
  });

  it("never posts an amount or currency from the browser", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: en.orderPage.markAsPaid }));

    await waitFor(() => expect(confirmCodCollectionAction).toHaveBeenCalled());
    const posted = confirmCodCollectionAction.mock.calls[0]?.[1];
    expect([...(posted?.keys() ?? [])].sort()).toEqual(["orderId", "paymentIntentId"]);
  });

  it("shows the error when the API refuses (a 409)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    confirmCodCollectionAction.mockResolvedValue({
      status: "error",
      message: "The collected amount must equal the amount due",
      fieldErrors: {},
    });
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: en.orderPage.markAsPaid }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The collected amount must equal the amount due",
    );
  });
});
