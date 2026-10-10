import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OrderDetailDto } from "@/lib/api/orders";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrderHeader } from "./order-header";

vi.mock("@/app/orders/actions", () => ({
  advanceOrderAction: vi.fn(),
  refundOrderAction: vi.fn(),
}));

function order(overrides: Partial<OrderDetailDto> = {}): OrderDetailDto {
  return {
    id: "order-1",
    orderNumber: "1001",
    status: "payment_requested",
    createdAt: new Date(2026, 9, 9, 20, 27).toISOString(),
    paymentStatus: "pending",
    fulfillmentStatus: "unfulfilled",
    ...overrides,
  } as OrderDetailDto;
}

describe("OrderHeader (Plan 3B)", () => {
  it("shows the short number and both badges", () => {
    render(<OrderHeader order={order()} t={en} locale="en" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("#1001");
    expect(screen.getByText("Payment pending")).toBeInTheDocument();
    expect(screen.getByText("Unfulfilled")).toBeInTheDocument();
  });

  it("shows the badges that match the order's two statuses", () => {
    render(
      <OrderHeader
        order={order({ paymentStatus: "paid", fulfillmentStatus: "delivered" })}
        t={en}
        locale="en"
      />,
    );

    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Delivered")).toBeInTheDocument();
  });

  it("says when and where the order was placed", () => {
    render(<OrderHeader order={order()} t={en} locale="en" />);

    expect(screen.getByText("October 9, 2026 at 8:27 pm from Online Store")).toBeInTheDocument();
  });

  it("links back to the orders list", () => {
    render(<OrderHeader order={order()} t={en} locale="en" />);

    expect(screen.getByRole("link", { name: en.orderDetail.back })).toHaveAttribute(
      "href",
      "/orders",
    );
  });

  it("enables Refund only for an order the backend can refund (paid)", () => {
    const { rerender } = render(
      <OrderHeader order={order({ status: "paid" })} t={en} locale="en" />,
    );
    expect(screen.getByRole("button", { name: "Refund" })).toBeEnabled();

    rerender(<OrderHeader order={order({ status: "payment_requested" })} t={en} locale="en" />);
    expect(screen.getByRole("button", { name: "Refund" })).toBeDisabled();
  });

  it("offers More actions with Cancel order only where the lifecycle allows it", () => {
    const { rerender } = render(
      <OrderHeader order={order({ status: "created" })} t={en} locale="en" />,
    );
    expect(screen.getByText("More actions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();

    // G-126: an unpaid cash-on-delivery order waits at payment_requested and can be cancelled.
    rerender(<OrderHeader order={order({ status: "payment_requested" })} t={en} locale="en" />);
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print packing slip" })).toBeInTheDocument();

    // Once the payment is received the order is refunded, never cancelled.
    rerender(<OrderHeader order={order({ status: "payment_received" })} t={en} locale="en" />);
    expect(screen.queryByRole("button", { name: "Cancel order" })).toBeNull();
    expect(screen.getByRole("button", { name: "Print packing slip" })).toBeInTheDocument();
  });

  it("renders in Arabic", () => {
    render(<OrderHeader order={order()} t={ar} locale="ar" />);

    expect(screen.getByText("في انتظار الدفع")).toBeInTheDocument();
    expect(screen.getByText("لم يتم التجهيز")).toBeInTheDocument();
    expect(screen.getByText(/من المتجر الإلكتروني/)).toBeInTheDocument();
  });
});
