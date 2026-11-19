import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";

const request = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/request-locale", () => ({
  getRequestLocale: async () => "en",
  getPreviewToken: async () => request.token,
}));
const resolveCurrentCart = vi.hoisted(() => vi.fn(async () => ({ status: "empty" as const })));
vi.mock("@/lib/cart", () => ({ GUEST_SESSION_COOKIE: "guest", resolveCurrentCart }));
vi.mock("@/components/cart-view", () => ({ CartView: () => null }));
const { default: CartPage } = await import("./page");

afterEach(() => vi.clearAllMocks());

describe("CartPage in preview (Ruling 15)", () => {
  it("says 'Not available in preview' and never reads a cart", async () => {
    request.token = "tok";
    render(await CartPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en.preview.unavailable);
    expect(screen.getByRole("note")).toHaveTextContent(en.preview.banner);
    expect(resolveCurrentCart).not.toHaveBeenCalled();
  });

  it("is the ordinary cart page otherwise", async () => {
    request.token = null;
    render(await CartPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en.cart.emptyTitle);
    expect(resolveCurrentCart).toHaveBeenCalledTimes(1);
  });
});
