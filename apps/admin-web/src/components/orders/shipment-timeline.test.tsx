import { beforeEach, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { ShipmentTimeline } from "./shipment-timeline";

beforeEach(() => {
  expect.hasAssertions();
});

it("renders scan text and place inside bdi dir=auto", () => {
  render(
    <ShipmentTimeline
      events={[
        {
          description: "Received at warehouse",
          location: "Cairo",
          occurredAt: "2026-11-10T10:00:00Z",
        },
      ]}
      t={ar}
      locale="ar"
    />,
  );
  const scan = screen.getByText("Received at warehouse");
  expect(scan.tagName).toBe("BDI");
  expect(scan).toHaveAttribute("dir", "auto");
  expect(screen.getByText("Cairo").tagName).toBe("BDI");
});

it("says there are no updates yet when empty", () => {
  render(<ShipmentTimeline events={[]} t={ar} locale="ar" />);
  expect(screen.getByText(ar.carrierShipping.noEvents)).toBeInTheDocument();
});
