import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { OrderRecipientAddressDto } from "@/lib/api/orders";
import { OrderAddressesCard } from "./order-addresses-card";

const shipping: OrderRecipientAddressDto = {
  recipientName: "Mona Ali",
  phone: "+201012345678",
  line1: "1 Main St",
  line2: null,
  city: "Cairo",
  postalCode: "11511",
  country: "EG",
};

describe("OrderAddressesCard (Plan 3A)", () => {
  it("shows the recipient's name in bold and the phone as a tel: link", () => {
    render(<OrderAddressesCard shippingAddress={shipping} billingAddress={null} t={en} />);

    const name = screen.getByText("Mona Ali");
    expect(name.tagName).toBe("STRONG");
    const phone = screen.getByRole("link", { name: "+201012345678" });
    expect(phone).toHaveAttribute("href", "tel:+201012345678");
    expect(phone).toHaveAttribute("dir", "ltr");
  });

  it("renders no empty line for a missing second line, name or phone", () => {
    render(
      <OrderAddressesCard
        shippingAddress={{ ...shipping, recipientName: null, phone: null }}
        billingAddress={null}
        t={en}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    const block = screen.getByText("1 Main St").closest("address");
    // line1, city/postal code, country — and nothing else.
    expect(block?.querySelectorAll("p")).toHaveLength(3);
  });

  it("shows the second line between the street and the city when there is one", () => {
    render(
      <OrderAddressesCard
        shippingAddress={{ ...shipping, line2: "Flat 4" }}
        billingAddress={null}
        t={en}
      />,
    );

    const lines = Array.from(
      screen.getByText("1 Main St").closest("address")?.querySelectorAll("p") ?? [],
    ).map((p) => p.textContent);
    expect(lines.slice(0, 4)).toEqual(["Mona Ali", "1 Main St", "Flat 4", "Cairo, 11511"]);
  });

  it("drops the dangling comma when the postal code is empty", () => {
    render(
      <OrderAddressesCard
        shippingAddress={{ ...shipping, postalCode: "" }}
        billingAddress={null}
        t={en}
      />,
    );

    expect(screen.getByText("Cairo")).toBeInTheDocument();
  });

  it("treats a billing address with the same place but another recipient as different", () => {
    render(
      <OrderAddressesCard
        shippingAddress={shipping}
        billingAddress={{ ...shipping, recipientName: "Omar Ali" }}
        t={en}
      />,
    );

    expect(screen.getByText("Omar Ali")).toBeInTheDocument();
    expect(screen.queryByText(en.orderDetail.sameAsShipping)).toBeNull();
  });
});
