import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "@/messages/en";
import type { CartActionResult } from "@/app/cart/actions";
import { AddToCartButton } from "./add-to-cart-button";

const addToCart = vi.fn<(productId: string, quantity: number) => Promise<CartActionResult>>();
vi.mock("@/app/cart/actions", () => ({
  addToCart: (productId: string, quantity: number) => addToCart(productId, quantity),
}));

beforeEach(() => {
  addToCart.mockReset();
});

describe("AddToCartButton (Task 9 entry point)", () => {
  it("adds a single unit of the product and shows the success state with a link to the cart", async () => {
    addToCart.mockResolvedValue({ ok: true });
    render(<AddToCartButton productId="prod-1" outOfStock={false} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: en.product.addToCart }));

    await waitFor(() => expect(addToCart).toHaveBeenCalledWith("prod-1", 1));
    expect(await screen.findByText(en.product.addedToCart)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.product.viewCart })).toHaveAttribute(
      "href",
      "/cart",
    );
  });

  it("shows the unavailable message when the action reports reason: 'unavailable'", async () => {
    addToCart.mockResolvedValue({ ok: false, reason: "unavailable" });
    render(<AddToCartButton productId="prod-1" outOfStock={false} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: en.product.addToCart }));

    expect(await screen.findByText(en.product.addToCartUnavailable)).toBeInTheDocument();
  });

  it("shows a generic error for ownership/network failures", async () => {
    addToCart.mockResolvedValue({ ok: false, reason: "network" });
    render(<AddToCartButton productId="prod-1" outOfStock={false} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: en.product.addToCart }));

    expect(await screen.findByText(en.product.addToCartError)).toBeInTheDocument();
  });

  it("is disabled when out of stock and never calls the action", () => {
    render(<AddToCartButton productId="prod-1" outOfStock t={en} />);

    const button = screen.getByRole("button", { name: en.product.addToCart });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(addToCart).not.toHaveBeenCalled();
  });
});
