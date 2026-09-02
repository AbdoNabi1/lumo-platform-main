import { beforeEach, describe, expect, it, vi } from "vitest";

const addWishlistItem = vi.fn();
const removeWishlistItem = vi.fn();
const shareWishlistItem = vi.fn();
const moveWishlistItemToCart = vi.fn();

vi.mock("@/lib/runtime-api", () => ({
  addWishlistItem: (...args: unknown[]) => addWishlistItem(...args),
  removeWishlistItem: (...args: unknown[]) => removeWishlistItem(...args),
  shareWishlistItem: (...args: unknown[]) => shareWishlistItem(...args),
  moveWishlistItemToCart: (...args: unknown[]) => moveWishlistItemToCart(...args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

let cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { value };
    },
    set: () => undefined,
  }),
}));

const actions = await import("./actions");
const { CUSTOMER_SESSION_COOKIE } = await import("@/lib/customer-session");
const { GUEST_SESSION_COOKIE } = await import("@/lib/cart");

const OK = { status: 200, body: { id: "w1", status: "active", items: [] } };

beforeEach(() => {
  cookieStore = new Map();
  for (const spy of [
    addWishlistItem,
    removeWishlistItem,
    shareWishlistItem,
    moveWishlistItemToCart,
    revalidatePath,
  ]) {
    spy.mockReset();
  }
});

function signedIn(): void {
  cookieStore.set(CUSTOMER_SESSION_COOKIE, "session-abc");
}

describe("addToWishlist", () => {
  it("sends the session id and an Idempotency-Key, and NO customerRef or wishlistId", async () => {
    signedIn();
    addWishlistItem.mockResolvedValue(OK);

    const result = await actions.addToWishlist("prod-1");

    expect(result).toEqual({ ok: true });
    expect(addWishlistItem).toHaveBeenCalledWith("session-abc", "prod-1", expect.any(String));
    // Exactly three arguments — there is no identifier for a caller to supply.
    expect(addWishlistItem.mock.calls[0]).toHaveLength(3);
  });

  it("refuses without a session and never calls the API", async () => {
    const result = await actions.addToWishlist("prod-1");

    expect(result).toEqual({ ok: false, reason: "signed-out" });
    expect(addWishlistItem).not.toHaveBeenCalled();
  });

  it("maps the guard's 401 to `signed-out`", async () => {
    signedIn();
    addWishlistItem.mockResolvedValue({ status: 401, body: null });

    expect(await actions.addToWishlist("prod-1")).toEqual({ ok: false, reason: "signed-out" });
  });

  it("uses a FRESH idempotency key per submit", async () => {
    signedIn();
    addWishlistItem.mockResolvedValue(OK);

    await actions.addToWishlist("prod-1");
    await actions.addToWishlist("prod-2");

    expect(addWishlistItem.mock.calls[0]?.[2]).not.toBe(addWishlistItem.mock.calls[1]?.[2]);
  });
});

describe("removeFromWishlist", () => {
  it("removes via the /me-scoped route", async () => {
    signedIn();
    removeWishlistItem.mockResolvedValue(OK);

    expect(await actions.removeFromWishlist("prod-1")).toEqual({ ok: true });
    expect(removeWishlistItem).toHaveBeenCalledWith("session-abc", "prod-1", expect.any(String));
  });

  it("refuses without a session", async () => {
    expect(await actions.removeFromWishlist("prod-1")).toEqual({
      ok: false,
      reason: "signed-out",
    });
  });
});

describe("shareWishlistProduct", () => {
  it("returns the real token the backend minted", async () => {
    signedIn();
    shareWishlistItem.mockResolvedValue({ status: 200, body: { ...OK.body, shareToken: "tok-1" } });

    expect(await actions.shareWishlistProduct("prod-1")).toEqual({ ok: true, shareToken: "tok-1" });
  });

  it("never invents a token when the call failed", async () => {
    signedIn();
    shareWishlistItem.mockResolvedValue({ status: 404, body: null });

    const result = await actions.shareWishlistProduct("prod-1");
    expect(result.ok).toBe(false);
    expect(result.shareToken).toBeUndefined();
  });
});

describe("moveToCart", () => {
  it("sends BOTH tokens — the customer session and the guest cart sessionRef", async () => {
    signedIn();
    cookieStore.set(GUEST_SESSION_COOKIE, "guest-1");
    moveWishlistItemToCart.mockResolvedValue(OK);

    const result = await actions.moveToCart("prod-1");

    expect(result).toEqual({ ok: true });
    expect(moveWishlistItemToCart).toHaveBeenCalledWith(
      "session-abc",
      "prod-1",
      "guest-1",
      expect.any(String),
    );
  });

  it("reports `cart` rather than pretending, when there is no guest cart to move into", async () => {
    signedIn();

    expect(await actions.moveToCart("prod-1")).toEqual({ ok: false, reason: "cart" });
    expect(moveWishlistItemToCart).not.toHaveBeenCalled();
  });

  it("maps a 422 (no resolvable price) to `cart` — the item stays on the wishlist", async () => {
    signedIn();
    cookieStore.set(GUEST_SESSION_COOKIE, "guest-1");
    moveWishlistItemToCart.mockResolvedValue({ status: 422, body: null });

    expect(await actions.moveToCart("prod-1")).toEqual({ ok: false, reason: "cart" });
  });

  it("refuses without a customer session even when a guest cart exists", async () => {
    cookieStore.set(GUEST_SESSION_COOKIE, "guest-1");

    expect(await actions.moveToCart("prod-1")).toEqual({ ok: false, reason: "signed-out" });
    expect(moveWishlistItemToCart).not.toHaveBeenCalled();
  });

  it("revalidates BOTH the wishlist and the cart on success", async () => {
    signedIn();
    cookieStore.set(GUEST_SESSION_COOKIE, "guest-1");
    moveWishlistItemToCart.mockResolvedValue(OK);

    await actions.moveToCart("prod-1");

    expect(revalidatePath).toHaveBeenCalledWith("/account/wishlist");
    expect(revalidatePath).toHaveBeenCalledWith("/cart");
  });
});
