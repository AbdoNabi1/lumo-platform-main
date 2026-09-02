import { beforeEach, describe, expect, it, vi } from "vitest";

const createProductReview = vi.fn();

vi.mock("@/lib/runtime-api", () => ({
  createProductReview: (...args: unknown[]) => createProductReview(...args),
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

const OK = { status: 201, body: { reviewId: "review-1", status: "pending" } };

beforeEach(() => {
  cookieStore = new Map();
  createProductReview.mockReset();
  revalidatePath.mockReset();
});

function signedIn(): void {
  cookieStore.set(CUSTOMER_SESSION_COOKIE, "session-abc");
}

describe("submitProductReview", () => {
  it("sends the session id, the review fields, and a fresh Idempotency-Key — no customerRef", async () => {
    signedIn();
    createProductReview.mockResolvedValue(OK);

    const result = await actions.submitProductReview("wooden-blocks", "prod-1", 5, "Loved it!");

    expect(result).toEqual({ ok: true, status: "pending" });
    expect(createProductReview).toHaveBeenCalledWith(
      "session-abc",
      { productRef: "prod-1", rating: 5, bodyText: "Loved it!" },
      expect.any(String),
    );
    // Exactly three arguments — there is no identifier field for a caller to supply.
    expect(createProductReview.mock.calls[0]).toHaveLength(3);
  });

  it("refuses without a session and never calls the API", async () => {
    const result = await actions.submitProductReview("wooden-blocks", "prod-1", 5, "Loved it!");

    expect(result).toEqual({ ok: false, reason: "signed-out" });
    expect(createProductReview).not.toHaveBeenCalled();
  });

  it("maps the guard's 401 to `signed-out`", async () => {
    signedIn();
    createProductReview.mockResolvedValue({ status: 401, body: null });

    expect(await actions.submitProductReview("wooden-blocks", "prod-1", 5, "x")).toEqual({
      ok: false,
      reason: "signed-out",
    });
  });

  it("maps a 409 (already reviewed this product) to `duplicate`", async () => {
    signedIn();
    createProductReview.mockResolvedValue({ status: 409, body: null });

    expect(await actions.submitProductReview("wooden-blocks", "prod-1", 5, "x")).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("maps a 422 to `validation`", async () => {
    signedIn();
    createProductReview.mockResolvedValue({ status: 422, body: null });

    expect(await actions.submitProductReview("wooden-blocks", "prod-1", 5, "x")).toEqual({
      ok: false,
      reason: "validation",
    });
  });

  it("uses a FRESH idempotency key per submit", async () => {
    signedIn();
    createProductReview.mockResolvedValue(OK);

    await actions.submitProductReview("wooden-blocks", "prod-1", 5, "x");
    await actions.submitProductReview("wooden-blocks", "prod-1", 4, "y");

    expect(createProductReview.mock.calls[0]?.[2]).not.toBe(createProductReview.mock.calls[1]?.[2]);
  });

  it("revalidates the product page on success", async () => {
    signedIn();
    createProductReview.mockResolvedValue(OK);

    await actions.submitProductReview("wooden-blocks", "prod-1", 5, "x");

    expect(revalidatePath).toHaveBeenCalledWith("/products/wooden-blocks");
  });

  it("never revalidates on failure", async () => {
    signedIn();
    createProductReview.mockResolvedValue({ status: 422, body: null });

    await actions.submitProductReview("wooden-blocks", "prod-1", 5, "x");

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
