import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import type { ResolvedCartLine } from "@/lib/cart";
import { DEFAULT_PUBLIC_CHECKOUT_SETTINGS } from "@/lib/checkout-settings-model";
import type { CartSummary } from "@/lib/runtime-api";
import type { CartActionResult } from "@/app/(store)/cart/actions";
import type { CheckoutActionResult } from "@/app/(store)/checkout/actions";
import { formatNumber } from "@/lib/format";
import { CartView } from "./cart-view";

const changeQuantity = vi.fn<(...args: unknown[]) => Promise<CartActionResult>>();
vi.mock("@/app/(store)/cart/actions", () => ({
  changeQuantity: (...args: unknown[]) => changeQuantity(...args),
  removeItem: vi.fn(),
  clearCart: vi.fn(),
}));
const startCheckout = vi.fn<(cartId: string) => Promise<CheckoutActionResult>>();
vi.mock("@/app/(store)/checkout/actions", () => ({
  startCheckout: (cartId: string) => startCheckout(cartId),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => vi.clearAllMocks());

const cart: CartSummary = {
  id: "cart-1",
  status: "active",
  currency: "USD",
  isGuest: true,
  items: [],
  subtotalAmountMinor: 9000,
};
const line = (quantity: number): ResolvedCartLine => ({
  productId: "prod-1",
  variantId: null,
  variantTitle: null,
  name: "Wooden Blocks",
  slug: "wooden-blocks",
  quantity,
  unitPriceAmountMinor: 1500,
  currency: "USD",
  lineTotalAmountMinor: 1500 * quantity,
  imageUrl: null,
});
const withLimit = (cartLineLimit: number | null) => ({
  ...DEFAULT_PUBLIC_CHECKOUT_SETTINGS,
  cartLineLimit,
});

describe("CartView and the add-to-cart limit", () => {
  it("without a limit, the stepper is open ended, as before", () => {
    render(<CartView cart={cart} lines={[line(500)]} t={en} locale="en" />);
    expect(screen.getByRole("button", { name: en.cart.increaseQuantity })).toBeEnabled();
  });

  it("a line AT the limit cannot be raised further; one below it can", () => {
    const { rerender } = render(
      <CartView cart={cart} lines={[line(3)]} t={en} locale="en" settings={withLimit(3)} />,
    );
    expect(screen.getByRole("button", { name: en.cart.increaseQuantity })).toBeDisabled();
    rerender(<CartView cart={cart} lines={[line(2)]} t={en} locale="en" settings={withLimit(3)} />);
    expect(screen.getByRole("button", { name: en.cart.increaseQuantity })).toBeEnabled();
  });

  it("a line above a lowered limit can still be lowered", () => {
    render(<CartView cart={cart} lines={[line(9)]} t={en} locale="en" settings={withLimit(3)} />);
    expect(screen.getByRole("button", { name: en.cart.increaseQuantity })).toBeDisabled();
    expect(screen.getByRole("button", { name: en.cart.decreaseQuantity })).toBeEnabled();
  });

  it("shows the server's refusal as the limit sentence, in the page's language", async () => {
    changeQuantity.mockResolvedValue({
      ok: false,
      reason: "limit",
      message: "You can add up to 3 of this item",
    });
    render(<CartView cart={cart} lines={[line(2)]} t={en} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: en.cart.increaseQuantity }));
    expect(await screen.findByText("You can add up to 3 of this item")).toBeInTheDocument();
  });

  it("speaks Arabic for the same refusal", async () => {
    changeQuantity.mockResolvedValue({
      ok: false,
      reason: "limit",
      message: "You can add up to 3 of this item",
    });
    render(<CartView cart={cart} lines={[line(2)]} t={ar as unknown as typeof en} locale="ar" />);
    fireEvent.click(screen.getByRole("button", { name: ar.cart.increaseQuantity }));
    expect(
      await screen.findByText(ar.cart.lineLimit.replace("{limit}", formatNumber("ar", 3))),
    ).toBeInTheDocument();
  });

  it("falls back to the server's own words when no number can be read", async () => {
    changeQuantity.mockResolvedValue({ ok: false, reason: "limit", message: "Too many" });
    render(<CartView cart={cart} lines={[line(2)]} t={en} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: en.cart.increaseQuantity }));
    expect(await screen.findByText("Too many")).toBeInTheDocument();
  });

  it("clears the notice after a change that works", async () => {
    changeQuantity
      .mockResolvedValueOnce({
        ok: false,
        reason: "limit",
        message: "You can add up to 3 of this item",
      })
      .mockResolvedValueOnce({ ok: true });
    render(<CartView cart={cart} lines={[line(2)]} t={en} locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: en.cart.increaseQuantity }));
    await screen.findByText("You can add up to 3 of this item");
    fireEvent.click(screen.getByRole("button", { name: en.cart.decreaseQuantity }));
    await waitFor(() => expect(screen.queryByText("You can add up to 3 of this item")).toBeNull());
  });
});

describe("CartView when checkout cannot start", () => {
  const proceed = () =>
    fireEvent.click(screen.getByRole("button", { name: en.cart.proceedToCheckout }));

  it("LOGIN_REQUIRED: 'Sign in to check out' with the sign-in and register links", async () => {
    startCheckout.mockResolvedValue({ ok: false, reason: "login-required" });
    render(<CartView cart={cart} lines={[line(1)]} t={en} locale="en" />);
    proceed();
    expect(await screen.findByText(en.checkout.loginRequired.title)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.checkout.loginRequired.signIn })).toHaveAttribute(
      "href",
      "/account/login",
    );
    expect(screen.getByRole("link", { name: en.checkout.loginRequired.register })).toHaveAttribute(
      "href",
      "/account/register",
    );
    expect(screen.queryByText(en.cart.checkoutErrorBody)).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("a line over the limit at checkout start says so instead of 'Couldn't start checkout'", async () => {
    startCheckout.mockResolvedValue({
      ok: false,
      reason: "validation",
      fields: [{ field: "quantity", message: "You can add up to 3 of this item" }],
    });
    render(<CartView cart={cart} lines={[line(5)]} t={en} locale="en" />);
    proceed();
    expect(await screen.findByText("You can add up to 3 of this item")).toBeInTheDocument();
    expect(screen.queryByText(en.cart.checkoutErrorBody)).toBeNull();
  });

  it("any other failure is the old message", async () => {
    startCheckout.mockResolvedValue({ ok: false, reason: "network" });
    render(<CartView cart={cart} lines={[line(1)]} t={en} locale="en" />);
    proceed();
    expect(await screen.findByText(en.cart.checkoutErrorBody)).toBeInTheDocument();
    expect(screen.queryByText(en.checkout.loginRequired.title)).toBeNull();
  });
});
