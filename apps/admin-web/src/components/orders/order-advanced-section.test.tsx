import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OrderDetailDto } from "@/lib/api/orders";
import { en } from "@/messages/en";
import { OrderAdvancedSection } from "./order-advanced-section";

vi.mock("@/app/orders/actions", () => ({
  advanceOrderAction: vi.fn(),
  markOrderPaidAction: vi.fn(),
  refundOrderAction: vi.fn(),
  requestFulfillmentAction: vi.fn(),
  requestPaymentCaptureAction: vi.fn(),
}));
// The returns and shipment cards read other contexts on the server; here they are just stand-ins.
vi.mock("./order-returns-card", () => ({
  OrderReturnsCard: () => <p>returns card</p>,
  OrderReturnsCardSkeleton: () => <p>returns skeleton</p>,
}));
vi.mock("./order-shipping-card", () => ({
  OrderShippingCard: () => <p>shipment card</p>,
  OrderShippingCardSkeleton: () => <p>shipment skeleton</p>,
}));

const order = { id: "order-1", status: "created" } as unknown as OrderDetailDto;

describe("OrderAdvancedSection (Plan 3B)", () => {
  it("is collapsed by default", () => {
    const { container } = render(<OrderAdvancedSection order={order} t={en} locale="en" />);

    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("Advanced")).toBeInTheDocument();
  });

  it("still contains today's lifecycle controls, unchanged", () => {
    render(<OrderAdvancedSection order={order} t={en} locale="en" />);

    expect(screen.getByText(en.orderLifecycle.advanceToLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(en.orderLifecycle.paymentRefLabel)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.orderLifecycle.markPaid })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.orderLifecycle.requestPaymentCapture }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.orderLifecycle.requestFulfillment }),
    ).toBeInTheDocument();
  });

  it("keeps the returns and shipment cards, with their links, inside it", () => {
    render(<OrderAdvancedSection order={order} t={en} locale="en" />);

    expect(screen.getByText("returns card")).toBeInTheDocument();
    expect(screen.getByText("shipment card")).toBeInTheDocument();
  });
});
