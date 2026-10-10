import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { OrderDetailDto } from "@/lib/api/orders";
import { en } from "@/messages/en";
import { OrderCustomerCard } from "./order-customer-card";

const fetchCustomer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/customers", () => ({ fetchCustomer }));

const writeText = vi.fn<(text: string) => Promise<void>>();
beforeEach(() => {
  fetchCustomer.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

function order(address: Partial<OrderDetailDto["shippingAddress"]> = {}): OrderDetailDto {
  return {
    id: "order-1",
    orderNumber: "1001",
    customerRef: "customer-1",
    status: "created",
    currency: "EGP",
    totalMinor: 1000,
    createdAt: new Date().toISOString(),
    items: [],
    shippingAddress: {
      line1: "1 Main St",
      city: "Cairo",
      postalCode: "",
      country: "EG",
      recipientName: "Mona Ali",
      phone: "+201012345678",
      line2: null,
      ...address,
    },
    billingAddress: null,
    totals: null,
    checkoutRef: null,
    paymentRef: null,
    fulfillmentRef: null,
    history: [],
    paymentStatus: "pending",
    fulfillmentStatus: "unfulfilled",
    paymentProvider: null,
    shippingMethod: null,
  };
}

async function renderCard(
  o: OrderDetailDto,
  customer: { id: string; name: string; email: string } | null,
) {
  fetchCustomer.mockResolvedValue(
    customer === null ? { outcome: "not_found" } : { outcome: "ok", customer },
  );
  render(await OrderCustomerCard({ order: o, t: en }));
}

describe("OrderCustomerCard (Plan 3B)", () => {
  it("shows the recipient's name, linking to the customer page", async () => {
    await renderCard(order(), { id: "c-9", name: "mona", email: "mona@example.com" });

    expect(screen.getByRole("link", { name: "Mona Ali" })).toHaveAttribute(
      "href",
      "/customers/c-9",
    );
  });

  it("uses the customer's own name when the order has no recipient name", async () => {
    await renderCard(order({ recipientName: null }), {
      id: "c-9",
      name: "Mona Hassan",
      email: "mona@example.com",
    });

    expect(screen.getByRole("link", { name: "Mona Hassan" })).toBeInTheDocument();
  });

  it("shows contact information: the email and the phone as links, each with a Copy button", async () => {
    await renderCard(order(), { id: "c-9", name: "Mona", email: "mona@example.com" });

    expect(screen.getByText("Contact information")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "mona@example.com" })).toHaveAttribute(
      "href",
      "mailto:mona@example.com",
    );
    const phone = screen.getByRole("link", { name: "+201012345678" });
    expect(phone).toHaveAttribute("href", "tel:+201012345678");
    expect(phone).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("button", { name: "Copy email address" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy phone number" })).toBeInTheDocument();
  });

  it("copies the email and the phone", async () => {
    await renderCard(order(), { id: "c-9", name: "Mona", email: "mona@example.com" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy email address" }));
    });
    expect(writeText).toHaveBeenLastCalledWith("mona@example.com");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy phone number" }));
    });
    expect(writeText).toHaveBeenLastCalledWith("+201012345678");
  });

  it("says so when there is no phone or no email, instead of a blank", async () => {
    await renderCard(order({ phone: null }), null);

    expect(screen.getByText(en.orderPage.noPhone)).toBeInTheDocument();
    expect(screen.getByText(en.orderPage.noEmail)).toBeInTheDocument();
  });

  it("keeps the recipient's name, unlinked, when Identity cannot find the customer", async () => {
    await renderCard(order(), null);

    expect(screen.getByText("Mona Ali")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Mona Ali" })).toBeNull();
  });

  it("shows the raw reference, never an invented name, when there is neither a name nor a profile", async () => {
    await renderCard(order({ recipientName: null }), null);

    expect(screen.getByText(en.orderDetail.noCustomerLinked)).toBeInTheDocument();
    expect(screen.getByText("customer-1")).toBeInTheDocument();
  });
});
