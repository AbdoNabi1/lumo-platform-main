import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { OrderRecipientAddressDto } from "@/lib/api/orders";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrderBillingAddressCard, OrderShippingAddressCard } from "./order-addresses-card";

const shipping: OrderRecipientAddressDto = {
  recipientName: "Mona Ali",
  phone: "+201012345678",
  line1: "1 Main St",
  line2: null,
  city: "Cairo",
  postalCode: "11511",
  country: "EG",
};

const writeText = vi.fn<(text: string) => Promise<void>>();
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

const renderShipping = (address = shipping, locale: "en" | "ar" = "en") =>
  render(
    <OrderShippingAddressCard address={address} t={locale === "en" ? en : ar} locale={locale} />,
  );

describe("OrderShippingAddressCard (Plan 3A, Plan 3B)", () => {
  it("shows the recipient's name in bold and the phone as a tel: link", () => {
    renderShipping();

    const name = screen.getByText("Mona Ali");
    expect(name.tagName).toBe("STRONG");
    const phone = screen.getByRole("link", { name: "+201012345678" });
    expect(phone).toHaveAttribute("href", "tel:+201012345678");
    expect(phone).toHaveAttribute("dir", "ltr");
  });

  it("shows the country as a name, not a code", () => {
    renderShipping();

    expect(screen.getByText("Egypt")).toBeInTheDocument();
    expect(screen.queryByText("EG")).toBeNull();
  });

  it("shows the Arabic country name on an Arabic page", () => {
    renderShipping(shipping, "ar");

    expect(screen.getByText("مصر")).toBeInTheDocument();
  });

  it("shows a country it cannot name as it was recorded", () => {
    renderShipping({ ...shipping, country: "Atlantis" });

    expect(screen.getByText("Atlantis")).toBeInTheDocument();
  });

  it("renders no empty line for a missing second line, name or phone", () => {
    renderShipping({ ...shipping, recipientName: null, phone: null });

    expect(screen.queryByRole("link", { name: /\+20/ })).toBeNull();
    const block = screen.getByText("1 Main St").closest("address");
    // line1, city/postal code, country — and nothing else.
    expect(block?.querySelectorAll("span")).toHaveLength(3);
    expect(block?.querySelector("strong")).toBeNull();
  });

  it("shows the second line between the street and the city when there is one", () => {
    renderShipping({ ...shipping, line2: "Flat 4" });

    const lines = Array.from(screen.getByText("1 Main St").closest("address")?.children ?? []).map(
      (el) => el.textContent,
    );
    expect(lines.slice(0, 4)).toEqual(["Mona Ali", "1 Main St", "Flat 4", "Cairo, 11511"]);
  });

  it("drops the dangling comma when the postal code is empty", () => {
    renderShipping({ ...shipping, postalCode: "" });

    expect(screen.getByText("Cairo")).toBeInTheDocument();
  });

  it("copies the whole formatted address", async () => {
    renderShipping({ ...shipping, line2: "Flat 4" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
    });

    expect(writeText).toHaveBeenCalledWith(
      "Mona Ali\n1 Main St\nFlat 4\nCairo, 11511\nEgypt\n+201012345678",
    );
  });

  it("links to the map in a new tab, safely, with the delivery address only", () => {
    renderShipping();

    const map = screen.getByRole("link", { name: "View map" });
    expect(map).toHaveAttribute("target", "_blank");
    expect(map).toHaveAttribute("rel", "noopener noreferrer");
    const href = map.getAttribute("href") ?? "";
    expect(href.startsWith("https://www.google.com/maps/search/?api=1&query=")).toBe(true);
    expect(decodeURIComponent(href.replace(/\+/g, " "))).toContain(
      "1 Main St, Cairo, 11511, Egypt",
    );
    expect(href).not.toContain("Mona");
    expect(href).not.toContain("2010");
  });
});

describe("OrderBillingAddressCard", () => {
  const renderBilling = (billingAddress: OrderRecipientAddressDto | null) =>
    render(
      <OrderBillingAddressCard
        shippingAddress={shipping}
        billingAddress={billingAddress}
        t={en}
        locale="en"
      />,
    );

  it("says Same as shipping address when it is", () => {
    renderBilling({ ...shipping });

    expect(screen.getByText(en.orderDetail.sameAsShipping)).toBeInTheDocument();
  });

  it("treats a billing address with the same place but another recipient as different", () => {
    renderBilling({ ...shipping, recipientName: "Omar Ali" });

    expect(screen.getByText("Omar Ali")).toBeInTheDocument();
    expect(screen.queryByText(en.orderDetail.sameAsShipping)).toBeNull();
  });

  it("says so when there is no billing address", () => {
    renderBilling(null);

    expect(screen.getByText(en.orderDetail.noBillingAddress)).toBeInTheDocument();
  });
});
