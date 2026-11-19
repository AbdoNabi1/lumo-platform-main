import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CarrierShipmentViewDto } from "@/lib/api/carrier-shipments";
import { ar } from "@/messages/ar";
import { OrderCarrierCard } from "./order-carrier-card";

vi.mock("@/app/orders/carrier-actions", () => ({
  shipWithCarrierAction: vi.fn(),
  retryCarrierShipmentAction: vi.fn(),
  cancelCarrierShipmentAction: vi.fn(),
  bulkShipWithCarrierAction: vi.fn(),
}));

type Shipment = NonNullable<CarrierShipmentViewDto["shipment"]>;
const carriers = [{ key: "bosta", displayName: "Bosta" }];

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "s1",
    fulfillmentRef: "f1",
    status: "label_created",
    carrier: "bosta",
    carrierService: null,
    trackingNumber: "TN123",
    shippedAt: null,
    deliveredAt: null,
    carrierDeliveryId: "d1",
    needsReview: false,
    trackingEvents: [
      { description: "Received at warehouse", location: null, occurredAt: "2026-11-10T10:00:00Z" },
    ],
    ...overrides,
  };
}

function view(
  next: Shipment | null,
  list: CarrierShipmentViewDto["carriers"] = carriers,
): CarrierShipmentViewDto {
  return { fulfillmentOrderId: next === null ? null : "f1", shipment: next, carriers: list };
}

function card(data: CarrierShipmentViewDto, fulfillmentStatus = "unfulfilled") {
  return render(
    <OrderCarrierCard
      orderId="order-1"
      fulfillmentStatus={fulfillmentStatus as "unfulfilled"}
      view={data}
      t={ar}
      locale="ar"
    />,
  );
}
const shipButton = () => screen.queryByRole("button", { name: "اشحن مع بوسطة" });

beforeEach(() => {
  expect.hasAssertions();
});

describe("OrderCarrierCard", () => {
  it("no shipment + enabled carrier shows ship", () => {
    card(view(null));
    expect(shipButton()).toBeInTheDocument();
  });

  it("no enabled carrier and no shipment renders nothing", () => {
    const { container } = card(view(null, []));
    expect(container).toBeEmptyDOMElement();
  });

  it("a fulfilled order offers no ship", () => {
    card(view(null), "fulfilled");
    expect(shipButton()).not.toBeInTheDocument();
  });

  it("label_created shows tracking, print and cancel", () => {
    card(view(shipment()));
    expect(screen.getByText("TN123")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ar.carrierShipping.trackOnCarrier })).toHaveAttribute(
      "href",
      "https://bosta.co/tracking-shipments",
    );
    const print = screen.getByRole("link", { name: ar.carrierShipping.printWaybill });
    expect(print).toHaveAttribute("href", "/orders/awb?orderIds=order-1");
    expect(print).toHaveAttribute("target", "_blank");
    expect(print).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      screen.getByRole("button", { name: ar.carrierShipping.cancelShipment }),
    ).toBeInTheDocument();
    expect(shipButton()).not.toBeInTheDocument();
  });

  it("an in-transit shipment has no cancel", () => {
    card(view(shipment({ status: "in_transit" })), "in_progress");
    expect(screen.getByText("TN123")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ar.carrierShipping.cancelShipment })).toBeNull();
    expect(shipButton()).not.toBeInTheDocument();
  });

  it.each(["created", "voided", "cancelled"])("a %s shipment shows ship", (status) => {
    card(view(shipment({ status, trackingNumber: null })));
    expect(shipButton()).toBeInTheDocument();
  });

  it("closed shows ship only while unfulfilled or in progress", () => {
    const first = card(view(shipment({ status: "closed" })), "in_progress");
    expect(shipButton()).toBeInTheDocument();
    first.unmount();
    card(view(shipment({ status: "closed" })), "fulfilled");
    expect(shipButton()).not.toBeInTheDocument();
  });

  it("needsReview shows the note and ship again, not ship", () => {
    card(view(shipment({ status: "exception", needsReview: true, trackingNumber: null })));
    expect(screen.getByText(ar.carrierShipping.needsReview)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.carrierShipping.shipAgain })).toBeInTheDocument();
    expect(shipButton()).not.toBeInTheDocument();
  });

  it("an exception without needsReview shows the note only", () => {
    card(view(shipment({ status: "exception", needsReview: false, trackingNumber: null })));
    expect(screen.getByText(ar.carrierShipping.needsReview)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ar.carrierShipping.shipAgain })).toBeNull();
    expect(shipButton()).not.toBeInTheDocument();
  });

  it("the timeline renders scans in bdi", () => {
    card(view(shipment()));
    const scan = screen.getByText("Received at warehouse");
    expect(scan.tagName).toBe("BDI");
    expect(scan).toHaveAttribute("dir", "auto");
  });
});
