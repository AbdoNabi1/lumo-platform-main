import { describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((): never => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import NewOrderPage from "./page";

describe("/orders/new", () => {
  it("sends the old create-order screen to a new draft (Shopify's behaviour)", () => {
    expect(() => NewOrderPage()).toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/draft-orders/new");
  });
});
