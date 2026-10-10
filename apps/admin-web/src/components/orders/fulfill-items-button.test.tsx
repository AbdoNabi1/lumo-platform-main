import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OrderDetailItemDto } from "@/lib/api/orders";
import type { FormState } from "@/lib/api/mutation";
import { en } from "@/messages/en";
import { FulfillItemsButton } from "./fulfill-items-button";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const createFulfillmentAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
vi.mock("@/app/orders/[orderId]/fulfillment/actions", () => ({
  createFulfillmentAction: (previous: FormState, formData: FormData) =>
    createFulfillmentAction(previous, formData),
}));

const items: OrderDetailItemDto[] = [
  {
    id: "item-1",
    productId: "product-1",
    name: "Shirt",
    variantRef: null,
    sku: null,
    variantTitle: null,
    unitPriceMinor: 1000,
    quantity: 2,
    lineTotalMinor: 2000,
  },
];

beforeEach(() => {
  push.mockReset();
  createFulfillmentAction.mockReset();
});

describe("FulfillItemsButton (Plan 3B)", () => {
  it("opens the fulfillment through the existing action with every item, then goes to the fulfillment page", async () => {
    createFulfillmentAction.mockResolvedValue({ status: "success" });
    render(<FulfillItemsButton orderId="order-1" items={items} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: "Fulfill items" }));

    await waitFor(() => expect(createFulfillmentAction).toHaveBeenCalledTimes(1));
    const form = createFulfillmentAction.mock.calls[0]?.[1] as FormData;
    expect(form.get("orderRef")).toBe("order-1");
    expect(form.getAll("includeItem")).toEqual(["item-1"]);
    expect(form.get("productRef_item-1")).toBe("product-1");
    expect(form.get("quantity_item-1")).toBe("2");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/order-1/fulfillment"));
  });

  it("stays on the page and shows the reason when the fulfillment cannot be opened", async () => {
    createFulfillmentAction.mockResolvedValue({
      status: "error",
      message: "Could not open the fulfillment",
      fieldErrors: {},
    });
    render(<FulfillItemsButton orderId="order-1" items={items} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: "Fulfill items" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not open the fulfillment");
    expect(push).not.toHaveBeenCalled();
  });

  it("does nothing for an order with no items", () => {
    render(<FulfillItemsButton orderId="order-1" items={[]} t={en} />);

    expect(screen.getByRole("button", { name: "Fulfill items" })).toBeDisabled();
  });
});
