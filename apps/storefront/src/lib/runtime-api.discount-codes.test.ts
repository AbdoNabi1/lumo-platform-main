import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const fetchMock = vi.fn();
const { applyCheckoutDiscountCode, removeCheckoutDiscountCode } = await import("./runtime-api");

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "checkout-1" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("applyCheckoutDiscountCode", () => {
  it("POSTs only the session ref and the typed code to the discount-codes route", async () => {
    const result = await applyCheckoutDiscountCode("checkout/1", "session-a", "SAVE10");

    expect(result).toEqual({ status: 200, body: { id: "checkout-1" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/public\/checkouts\/checkout%2F1\/discount-codes$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ sessionRef: "session-a", code: "SAVE10" });
  });

  it("keeps a 422 envelope readable", async () => {
    const envelope = { code: "VALIDATION", fields: [{ field: "code", message: "expired" }] };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(envelope), { status: 422 }));

    expect(await applyCheckoutDiscountCode("checkout-1", "session-a", "OLD")).toEqual({
      status: 422,
      body: envelope,
    });
  });
});

describe("removeCheckoutDiscountCode", () => {
  it("DELETEs the encoded code with the session in the x-cart-session header only", async () => {
    const result = await removeCheckoutDiscountCode("checkout-1", "session-a", "SAVE 10/x");

    expect(result).toEqual({ status: 200, body: { id: "checkout-1" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/public\/checkouts\/checkout-1\/discount-codes\/SAVE%2010%2Fx$/);
    expect(url).not.toContain("sessionRef");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toMatchObject({ "x-cart-session": "session-a" });
    expect(init.body).toBeUndefined();
  });

  it("collapses an unreachable runtime to status 0", async () => {
    fetchMock.mockRejectedValue(new Error("down"));

    expect(await removeCheckoutDiscountCode("checkout-1", "session-a", "X")).toEqual({
      status: 0,
      body: null,
    });
  });
});
