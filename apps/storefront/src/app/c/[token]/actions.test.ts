import { beforeEach, describe, expect, it, vi } from "vitest";

const claimApi = vi.hoisted(() => vi.fn());
vi.mock("@/lib/runtime-api", () => ({ claimCheckoutLink: claimApi }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));

const jar = new Map<string, string>();
const set = vi.fn((name: string, value: string) => void jar.set(name, value));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set,
  }),
}));

const { CHECKOUT_SESSION_COOKIE_OPTIONS } = await import("@/lib/cart");
const { claimCheckoutLink } = await import("./actions");

const TOKEN = "a".repeat(43);

beforeEach(() => {
  jar.clear();
  set.mockClear();
  claimApi.mockReset();
  redirect.mockClear();
  revalidatePath.mockClear();
});

describe("claimCheckoutLink (the Continue to checkout button)", () => {
  it("claims with the browser's guest session, sets the checkout cookie and opens /checkout", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    claimApi.mockResolvedValue({
      status: 200,
      body: { checkoutSessionId: "cs-new", droppedItems: 0 },
    });

    await expect(claimCheckoutLink(TOKEN)).rejects.toThrow("NEXT_REDIRECT /checkout");
    expect(claimApi).toHaveBeenCalledWith(TOKEN, "guest-1");
    expect(set).toHaveBeenCalledWith(
      "morbeh_checkout_session",
      "cs-new",
      CHECKOUT_SESSION_COOKIE_OPTIONS,
    );
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenLastCalledWith("/checkout");
    expect(revalidatePath).toHaveBeenCalledWith("/checkout");
    expect(revalidatePath).toHaveBeenCalledWith("/cart");
  });

  it("mints a guest session first when the browser has none (a link opened in a fresh browser)", async () => {
    claimApi.mockResolvedValue({
      status: 200,
      body: { checkoutSessionId: "cs-new", droppedItems: 0 },
    });
    await expect(claimCheckoutLink(TOKEN)).rejects.toThrow("NEXT_REDIRECT /checkout");
    const minted = jar.get("morbeh-storefront-guest-session");
    expect(minted).toBeDefined();
    expect(claimApi).toHaveBeenCalledWith(TOKEN, minted);
  });

  it("tells the checkout when some items were dropped", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    claimApi.mockResolvedValue({
      status: 200,
      body: { checkoutSessionId: "cs-new", droppedItems: 2 },
    });
    await expect(claimCheckoutLink(TOKEN)).rejects.toThrow("NEXT_REDIRECT /checkout?dropped=1");
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenLastCalledWith("/checkout?dropped=1");
  });

  it.each([
    [404, "invalid"],
    [409, "unavailable"],
    [0, "network"],
  ])(
    "a %s answer goes back to the link page with error=%s and sets no checkout cookie",
    async (status, error) => {
      jar.set("morbeh-storefront-guest-session", "guest-1");
      claimApi.mockResolvedValue({ status, body: null });
      await expect(claimCheckoutLink(TOKEN)).rejects.toThrow(
        `NEXT_REDIRECT /c/${TOKEN}?error=${error}`,
      );
      expect(redirect).toHaveBeenLastCalledWith(`/c/${TOKEN}?error=${error}`);
      expect(jar.has("morbeh_checkout_session")).toBe(false);
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("a malformed token never reaches the API", async () => {
    await expect(claimCheckoutLink("../../admin")).rejects.toThrow("NEXT_REDIRECT /");
    expect(redirect).toHaveBeenCalledWith("/");
    expect(claimApi).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});

describe("claimCheckoutLink — invoice links (order operations Part 4)", () => {
  it("remembers that this checkout came from an invoice, so a lost one says 'open your link again'", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    claimApi.mockResolvedValue({
      status: 200,
      body: { checkoutSessionId: "cs-invoice", droppedItems: 0 },
    });
    await expect(claimCheckoutLink(TOKEN, "invoice")).rejects.toThrow("NEXT_REDIRECT /checkout");
    expect(set).toHaveBeenCalledWith(
      "morbeh_invoice_checkout",
      "cs-invoice",
      CHECKOUT_SESSION_COOKIE_OPTIONS,
    );
  });

  it("a recovery claim leaves no invoice marker", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    claimApi.mockResolvedValue({
      status: 200,
      body: { checkoutSessionId: "cs-new", droppedItems: 0 },
    });
    await expect(claimCheckoutLink(TOKEN, "recovery")).rejects.toThrow("NEXT_REDIRECT /checkout");
    expect(set).not.toHaveBeenCalledWith(
      "morbeh_invoice_checkout",
      expect.anything(),
      expect.anything(),
    );
  });

  it("a completed draft goes back to the page with error=completed", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    claimApi.mockResolvedValue({
      status: 409,
      body: { code: "ALREADY_COMPLETED", message: "ALREADY_COMPLETED: placed" },
    });
    await expect(claimCheckoutLink(TOKEN)).rejects.toThrow(
      `NEXT_REDIRECT /c/${TOKEN}?error=completed`,
    );
    expect(set).not.toHaveBeenCalledWith(
      "morbeh_checkout_session",
      expect.anything(),
      expect.anything(),
    );
  });

  it.each([
    ["DRAFT_COMPLETED", "completed"],
    ["DRAFT_NOT_READY", "notReady"],
    ["DRAFT_BUSY", "busy"],
    ["DRAFT_TOTAL_TOO_LARGE", "tooLarge"],
    ["OUT_OF_STOCK", "outOfStock"],
    ["ITEMS_UNAVAILABLE", "unavailable"],
    ["SOMETHING_ELSE_ENTIRELY", "unavailable"],
  ])("a 409 %s goes back to the page with error=%s", async (code, error) => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    claimApi.mockResolvedValue({ status: 409, body: { code } });
    await expect(claimCheckoutLink(TOKEN)).rejects.toThrow(
      `NEXT_REDIRECT /c/${TOKEN}?error=${error}`,
    );
    expect(jar.has("morbeh_checkout_session")).toBe(false);
  });

  it("a 409 with no readable body is still 'unavailable'", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    claimApi.mockResolvedValue({ status: 409, body: null });
    await expect(claimCheckoutLink(TOKEN)).rejects.toThrow(
      `NEXT_REDIRECT /c/${TOKEN}?error=unavailable`,
    );
  });

  it("a 404 LINK_INVALID (revoked link, deleted draft) is 'invalid'", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    claimApi.mockResolvedValue({ status: 404, body: { code: "LINK_INVALID" } });
    await expect(claimCheckoutLink(TOKEN)).rejects.toThrow(
      `NEXT_REDIRECT /c/${TOKEN}?error=invalid`,
    );
  });

  it("never echoes the server's message text into the redirect", async () => {
    jar.set("morbeh-storefront-guest-session", "guest-1");
    claimApi.mockResolvedValue({
      status: 409,
      body: { code: "DRAFT_NOT_READY", message: "DRAFT_NOT_READY: shipping_address missing" },
    });
    await expect(claimCheckoutLink(TOKEN)).rejects.toThrow();
    expect(redirect).toHaveBeenLastCalledWith(`/c/${TOKEN}?error=notReady`);
  });
});
