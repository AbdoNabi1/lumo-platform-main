import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PackingSlipDto } from "@/lib/api/orders";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { PackingSlip } from "./packing-slip";

function slip(overrides: Partial<PackingSlipDto> = {}): PackingSlipDto {
  return {
    orderId: "o-1",
    orderNumber: "1001",
    createdAt: "2026-10-18T09:05:00.000Z",
    shipTo: {
      name: "Mona Ali",
      phone: "+201012345678",
      line1: "1 Nile St",
      line2: null,
      city: "Cairo",
      province: "EG-C",
      postalCode: "11511",
      country: "EG",
    },
    lines: [
      { title: "T-shirt", variantTitle: "L", sku: "SKU-1", quantity: 2 },
      { title: "Cap", variantTitle: null, sku: null, quantity: 1 },
    ],
    note: null,
    codAmountMinor: 125000,
    currency: "EGP",
    ...overrides,
  };
}

describe("PackingSlip (order operations Part 1)", () => {
  it("prints the shop, the order, the ship-to block, the lines and the cash to collect", () => {
    render(
      <PackingSlip
        timeZone="Africa/Cairo"
        slip={slip()}
        shopName="Morbeh Shop"
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText("Morbeh Shop")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Order #1001" })).toBeInTheDocument();
    expect(screen.getByText("Mona Ali")).toBeInTheDocument();
    expect(screen.getByText("+201012345678")).toBeInTheDocument();
    expect(screen.getByText("Cairo, Cairo")).toBeInTheDocument();
    expect(screen.getByText("T-shirt")).toBeInTheDocument();
    expect(screen.getByText("SKU SKU-1")).toBeInTheDocument();
    expect(screen.getByText(/^Collect: /)).toHaveTextContent("1,250.00");
  });

  it("dates the slip in the SHOP's time zone, like the CSV", () => {
    // 23:30 UTC on Oct 18 is already Oct 19 in Cairo (UTC+3), still Oct 18 in UTC.
    const late = slip({ createdAt: "2026-10-18T23:30:00.000Z" });
    const { rerender } = render(
      <PackingSlip timeZone="Africa/Cairo" slip={late} shopName="Shop" t={en} locale="en" />,
    );
    expect(screen.getByText("October 19, 2026")).toBeInTheDocument();
    rerender(<PackingSlip timeZone="UTC" slip={late} shopName="Shop" t={en} locale="en" />);
    expect(screen.getByText("October 18, 2026")).toBeInTheDocument();
  });

  it("has no Collect line when nothing is due on delivery", () => {
    render(
      <PackingSlip
        timeZone="Africa/Cairo"
        slip={slip({ codAmountMinor: 0 })}
        shopName="Shop"
        t={en}
        locale="en"
      />,
    );
    expect(screen.queryByText(/^Collect: /)).toBeNull();
  });

  it("names the province in Arabic for an Arabic admin", () => {
    render(
      <PackingSlip timeZone="Africa/Cairo" slip={slip()} shopName="Shop" t={ar} locale="ar" />,
    );
    expect(screen.getByText(/القاهرة/)).toBeInTheDocument();
  });

  it("prints the note when there is one", () => {
    render(
      <PackingSlip
        timeZone="Africa/Cairo"
        slip={slip({ note: "Leave with the doorman" })}
        shopName="Shop"
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText("Leave with the doorman")).toBeInTheDocument();
    expect(screen.getByText("Note")).toBeInTheDocument();
  });
});
