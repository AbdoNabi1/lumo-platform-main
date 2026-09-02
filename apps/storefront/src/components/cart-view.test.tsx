import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import type { ResolvedCartLine } from "@/lib/cart";
import type { CartSummary } from "@/lib/runtime-api";
import type { CartActionResult } from "@/app/cart/actions";
import type { CheckoutActionResult } from "@/app/checkout/actions";
import { CartView } from "./cart-view";

const changeQuantity =
  vi.fn<(cartId: string, productId: string, quantity: number) => Promise<CartActionResult>>();
const removeItem = vi.fn<(cartId: string, productId: string) => Promise<CartActionResult>>();
const clearCart = vi.fn<(cartId: string) => Promise<CartActionResult>>();

vi.mock("@/app/cart/actions", () => ({
  changeQuantity: (cartId: string, productId: string, quantity: number) =>
    changeQuantity(cartId, productId, quantity),
  removeItem: (cartId: string, productId: string) => removeItem(cartId, productId),
  clearCart: (cartId: string) => clearCart(cartId),
}));

const startCheckout = vi.fn<(cartId: string) => Promise<CheckoutActionResult>>();
vi.mock("@/app/checkout/actions", () => ({
  startCheckout: (cartId: string) => startCheckout(cartId),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  vi.clearAllMocks();
});

function cart(overrides: Partial<CartSummary> = {}): CartSummary {
  return {
    id: "cart-1",
    status: "active",
    currency: "USD",
    isGuest: true,
    items: [],
    subtotalAmountMinor: 0,
    ...overrides,
  };
}

function line(overrides: Partial<ResolvedCartLine> = {}): ResolvedCartLine {
  return {
    productId: "prod-1",
    name: "Wooden Blocks",
    slug: "wooden-blocks",
    quantity: 2,
    unitPriceAmountMinor: 1500,
    currency: "USD",
    lineTotalAmountMinor: 3000,
    ...overrides,
  };
}

describe("CartView — rendering", () => {
  it("renders each line's name (linked to its product page), quantity, unit price, and line total", () => {
    render(
      <CartView cart={cart({ subtotalAmountMinor: 3000 })} lines={[line()]} t={en} locale="en" />,
    );

    expect(screen.getByRole("link", { name: "Wooden Blocks" })).toHaveAttribute(
      "href",
      "/products/wooden-blocks",
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/\$15\.00 each/)).toBeInTheDocument();
    expect(screen.getAllByText("$30.00")).toHaveLength(2);
  });

  it("renders the cart subtotal, not a recomputed total", () => {
    render(
      <CartView
        cart={cart({ subtotalAmountMinor: 7599, currency: "USD" })}
        lines={[line()]}
        t={en}
        locale="en"
      />,
    );

    expect(screen.getByText(en.cart.subtotal)).toBeInTheDocument();
    expect(screen.getByText("$75.99")).toBeInTheDocument();
  });

  it("shows a plain-text fallback, not a link, when a line's product can't be resolved", () => {
    render(
      <CartView cart={cart()} lines={[line({ name: null, slug: null })]} t={en} locale="en" />,
    );

    expect(screen.getByText(en.cart.productUnavailable)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /wooden blocks/i })).not.toBeInTheDocument();
  });

  it("shows a status badge for a non-active cart (e.g. locked) but not for an active one", () => {
    const { rerender } = render(
      <CartView cart={cart({ status: "locked" })} lines={[line()]} t={en} locale="en" />,
    );
    expect(screen.getByText(en.cart.status.locked)).toBeInTheDocument();

    rerender(<CartView cart={cart({ status: "active" })} lines={[line()]} t={en} locale="en" />);
    expect(screen.queryByText(en.cart.status.active)).not.toBeInTheDocument();
  });

  it("renders in Arabic", () => {
    render(<CartView cart={cart()} lines={[line()]} t={ar} locale="ar" />);

    expect(screen.getByText(ar.cart.title)).toBeInTheDocument();
    expect(screen.getByText(ar.cart.subtotal)).toBeInTheDocument();
  });

  it("disables the decrease-quantity control at a quantity of 1 (floor, not a delete)", () => {
    render(<CartView cart={cart()} lines={[line({ quantity: 1 })]} t={en} locale="en" />);

    expect(screen.getByRole("button", { name: en.cart.decreaseQuantity })).toBeDisabled();
  });
});

describe("CartView — mutations (Task 8)", () => {
  it("increasing quantity calls changeQuantity with cartId/productId/quantity+1", async () => {
    changeQuantity.mockResolvedValue({ ok: true });
    render(
      <CartView
        cart={cart({ id: "cart-9" })}
        lines={[line({ productId: "p1", quantity: 2 })]}
        t={en}
        locale="en"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: en.cart.increaseQuantity }));

    await waitFor(() => expect(changeQuantity).toHaveBeenCalledWith("cart-9", "p1", 3));
  });

  it("removing a line calls removeItem with cartId/productId", async () => {
    removeItem.mockResolvedValue({ ok: true });
    render(
      <CartView
        cart={cart({ id: "cart-9" })}
        lines={[line({ productId: "p1" })]}
        t={en}
        locale="en"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: en.cart.remove }));

    await waitFor(() => expect(removeItem).toHaveBeenCalledWith("cart-9", "p1"));
  });

  it("clearing the cart calls clearCart with cartId", async () => {
    clearCart.mockResolvedValue({ ok: true });
    render(<CartView cart={cart({ id: "cart-9" })} lines={[line()]} t={en} locale="en" />);

    fireEvent.click(screen.getByRole("button", { name: en.cart.clearCart }));

    await waitFor(() => expect(clearCart).toHaveBeenCalledWith("cart-9"));
  });

  it("shows the ownership-error message when a mutation reports reason: 'ownership'", async () => {
    removeItem.mockResolvedValue({ ok: false, reason: "ownership" });
    render(<CartView cart={cart()} lines={[line({ productId: "p1" })]} t={en} locale="en" />);

    fireEvent.click(screen.getByRole("button", { name: en.cart.remove }));

    expect(await screen.findByRole("alert")).toHaveTextContent(en.cart.ownershipErrorBody);
  });

  it("shows the network-error message (API error state) when a mutation reports reason: 'network'", async () => {
    changeQuantity.mockResolvedValue({ ok: false, reason: "network" });
    render(<CartView cart={cart()} lines={[line({ productId: "p1" })]} t={en} locale="en" />);

    fireEvent.click(screen.getByRole("button", { name: en.cart.increaseQuantity }));

    expect(await screen.findByRole("alert")).toHaveTextContent(en.cart.networkErrorBody);
  });

  it("clears a previous error once a later mutation succeeds", async () => {
    removeItem.mockResolvedValueOnce({ ok: false, reason: "network" });
    render(
      <CartView
        cart={cart({ id: "cart-9" })}
        lines={[line({ productId: "p1" })]}
        t={en}
        locale="en"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: en.cart.remove }));
    await screen.findByRole("alert");

    removeItem.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: en.cart.remove }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("disables the clear-cart button when the cart has no lines", () => {
    render(<CartView cart={cart()} lines={[]} t={en} locale="en" />);

    expect(screen.getByRole("button", { name: en.cart.clearCart })).toBeDisabled();
  });
});

describe("CartView — proceed to checkout (Phase 2)", () => {
  it("disables the checkout button when the cart has no lines", () => {
    render(<CartView cart={cart()} lines={[]} t={en} locale="en" />);

    expect(screen.getByRole("button", { name: en.cart.proceedToCheckout })).toBeDisabled();
  });

  it("starts checkout and navigates to /checkout on success", async () => {
    startCheckout.mockResolvedValue({ ok: true, checkoutSessionId: "checkout-1" });
    render(<CartView cart={cart({ id: "cart-9" })} lines={[line()]} t={en} locale="en" />);

    fireEvent.click(screen.getByRole("button", { name: en.cart.proceedToCheckout }));

    await waitFor(() => expect(startCheckout).toHaveBeenCalledWith("cart-9"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/checkout"));
  });

  it("shows an error and does not navigate when starting checkout fails", async () => {
    startCheckout.mockResolvedValue({ ok: false, reason: "network" });
    render(<CartView cart={cart({ id: "cart-9" })} lines={[line()]} t={en} locale="en" />);

    fireEvent.click(screen.getByRole("button", { name: en.cart.proceedToCheckout }));

    expect(await screen.findByText(en.cart.checkoutErrorBody)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
