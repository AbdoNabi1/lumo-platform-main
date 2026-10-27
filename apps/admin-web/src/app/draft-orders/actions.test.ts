import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftOrderInput } from "@/lib/api/draft-orders";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({
  completeDraftOrder: vi.fn(),
  createDraftOrder: vi.fn(),
  deleteDraftOrder: vi.fn(),
  fetchDraftOrder: vi.fn(),
  fetchDraftShippingRates: vi.fn(),
  issueDraftInvoiceLink: vi.fn(),
  updateDraftOrder: vi.fn(),
  fetchProductsPage: vi.fn(),
  fetchProduct: vi.fn(),
  fetchCustomersPage: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());
const cookieLocale = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("@/lib/api/draft-orders", () => ({
  completeDraftOrder: api.completeDraftOrder,
  createDraftOrder: api.createDraftOrder,
  deleteDraftOrder: api.deleteDraftOrder,
  fetchDraftOrder: api.fetchDraftOrder,
  fetchDraftShippingRates: api.fetchDraftShippingRates,
  issueDraftInvoiceLink: api.issueDraftInvoiceLink,
  updateDraftOrder: api.updateDraftOrder,
}));
vi.mock("@/lib/api/products", () => ({
  fetchProductsPage: api.fetchProductsPage,
  fetchProduct: api.fetchProduct,
}));
vi.mock("@/lib/api/customers", () => ({ fetchCustomersPage: api.fetchCustomersPage }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieLocale.value === undefined ? undefined : { value: cookieLocale.value }),
  }),
}));

const {
  completeDraftOrderAction,
  deleteDraftOrderAction,
  draftProductVariantsAction,
  draftShippingRatesAction,
  saveDraftOrderAction,
  searchDraftCustomersAction,
  searchDraftProductsAction,
  sendDraftInvoiceAction,
} = await import("./actions");

const DRAFT_ID = "01920000-0000-7000-8000-00000000d003";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const e = en.draftOrders.editor.errors;
const INPUT: DraftOrderInput = {
  customerId: null,
  email: null,
  phone: null,
  shippingAddress: null,
  billingAddress: null,
  lines: [{ productId: "p-1", quantity: 1 }],
  discount: null,
  shipping: null,
  note: null,
  tags: [],
};

beforeEach(() => {
  vi.stubEnv("STOREFRONT_URL", "");
  cookieLocale.value = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("sendDraftInvoiceAction", () => {
  it("sends NO idempotency key and builds the link from STOREFRONT_URL when the shop has no domain", async () => {
    api.issueDraftInvoiceLink.mockResolvedValue({
      outcome: "ok",
      data: { url: null, path: "/c/abc", expiresAt: "x", shopName: "Shop" },
    });
    vi.stubEnv("STOREFRONT_URL", "https://shop.example/");
    const result = await sendDraftInvoiceAction(DRAFT_ID);
    expect(api.issueDraftInvoiceLink).toHaveBeenCalledWith(DRAFT_ID);
    expect(api.issueDraftInvoiceLink.mock.calls[0]).toHaveLength(1);
    expect(result).toEqual({ ok: true, url: "https://shop.example/c/abc", shopName: "Shop" });
  });

  it("asks for a new link on every press (the token is never cached)", async () => {
    api.issueDraftInvoiceLink.mockResolvedValue({
      outcome: "ok",
      data: { url: "https://x.shop/c/abc", path: "/c/abc", expiresAt: "x", shopName: "Shop" },
    });
    await sendDraftInvoiceAction(DRAFT_ID);
    await sendDraftInvoiceAction(DRAFT_ID);
    expect(api.issueDraftInvoiceLink.mock.calls).toEqual([[DRAFT_ID], [DRAFT_ID]]);
  });

  it("says so when the shop has no address to build a link on", async () => {
    api.issueDraftInvoiceLink.mockResolvedValue({
      outcome: "ok",
      data: { url: null, path: "/c/abc", expiresAt: "x", shopName: "Shop" },
    });
    expect(await sendDraftInvoiceAction(DRAFT_ID)).toMatchObject({
      ok: false,
      message: e.noStoreAddress,
    });
  });

  it("names a completed draft (DRAFT_COMPLETED)", async () => {
    api.issueDraftInvoiceLink.mockResolvedValue({
      outcome: "conflict",
      message: "DRAFT_COMPLETED: this draft order is already an order",
    });
    expect(await sendDraftInvoiceAction(DRAFT_ID)).toEqual({
      ok: false,
      message: e.draftCompleted,
      code: "DRAFT_COMPLETED",
    });
  });

  it("refuses a malformed draft id without calling the API", async () => {
    expect(await sendDraftInvoiceAction("../x")).toMatchObject({ ok: false });
    expect(api.issueDraftInvoiceLink).not.toHaveBeenCalled();
  });
});

describe("completeDraftOrderAction", () => {
  it("maps COD_NOT_ENABLED to words and sends one key per submit", async () => {
    api.completeDraftOrder.mockResolvedValue({
      outcome: "conflict",
      message: "COD_NOT_ENABLED: turn on cash on delivery",
    });
    expect(await completeDraftOrderAction(DRAFT_ID, "collect_on_delivery")).toEqual({
      ok: false,
      message: e.codNotEnabled,
      code: "COD_NOT_ENABLED",
    });
    expect(api.completeDraftOrder.mock.calls[0]?.[2]).toMatch(UUID);
  });

  it.each([
    ["VERSION_CONFLICT", e.conflict],
    ["DRAFT_COMPLETED", e.draftCompleted],
    ["ALREADY_COMPLETED", e.alreadyCompleted],
    ["COD_NOT_ENABLED", e.codNotEnabled],
    ["OUT_OF_STOCK", e.outOfStock],
    ["DRAFT_TOTAL_TOO_LARGE", e.totalTooLarge],
    ["DRAFT_BUSY", e.busy],
  ])("gives %s its own words", async (code, message) => {
    api.completeDraftOrder.mockResolvedValue({ outcome: "conflict", message: `${code}: x` });
    expect(await completeDraftOrderAction(DRAFT_ID, "paid")).toEqual({
      ok: false,
      message,
      code,
    });
  });

  it("every 409 code has distinct words", () => {
    const words = [
      e.conflict,
      e.draftCompleted,
      e.alreadyCompleted,
      e.codNotEnabled,
      e.outOfStock,
      e.totalTooLarge,
      e.busy,
      e.paymentNotRecorded,
      e.orderNotUpdated,
    ];
    expect(new Set(words).size).toBe(words.length);
  });

  it("PAYMENT_NOT_RECORDED names the order that was created (read off the now-completed draft)", async () => {
    api.completeDraftOrder.mockResolvedValue({
      outcome: "conflict",
      message: "PAYMENT_NOT_RECORDED: the order exists but the payment was not recorded; try again",
    });
    api.fetchDraftOrder.mockResolvedValue({
      outcome: "ok",
      data: { id: DRAFT_ID, order: { id: "o-1", orderNumber: "1001" } },
    });
    expect(await completeDraftOrderAction(DRAFT_ID, "paid")).toEqual({
      ok: false,
      message: e.paymentNotRecorded.replace("{number}", "1001"),
      code: "PAYMENT_NOT_RECORDED",
    });
    expect(api.fetchDraftOrder).toHaveBeenCalledWith(DRAFT_ID);
  });

  it("PAYMENT_NOT_RECORDED without a readable order number still says the order exists", async () => {
    api.completeDraftOrder.mockResolvedValue({
      outcome: "conflict",
      message: "PAYMENT_NOT_RECORDED: x",
    });
    api.fetchDraftOrder.mockResolvedValue({ outcome: "error", message: "boom" });
    expect(await completeDraftOrderAction(DRAFT_ID, "paid")).toEqual({
      ok: false,
      message: e.paymentNotRecordedNoNumber,
      code: "PAYMENT_NOT_RECORDED",
    });
  });

  it("the 503 (order placed, draft not updated) is its own retryable answer", async () => {
    api.completeDraftOrder.mockResolvedValue({
      outcome: "error",
      message: "Admin API responded with status 503",
    });
    expect(await completeDraftOrderAction(DRAFT_ID, "collect_on_delivery")).toEqual({
      ok: false,
      message: e.orderNotUpdated,
      code: "ORDER_NOT_UPDATED",
    });
  });

  it("each retry is a new submit with a new key (a replayed key answers the cached failure)", async () => {
    api.completeDraftOrder.mockResolvedValue({ outcome: "conflict", message: "DRAFT_BUSY: x" });
    await completeDraftOrderAction(DRAFT_ID, "paid");
    await completeDraftOrderAction(DRAFT_ID, "paid");
    const [first, second] = api.completeDraftOrder.mock.calls.map((call) => call[2]);
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(first).not.toBe(second);
  });

  it("an operator's Mark as paid (403) gets its own words, not the generic error", async () => {
    api.completeDraftOrder.mockResolvedValue({ outcome: "forbidden" });
    expect(await completeDraftOrderAction(DRAFT_ID, "paid")).toEqual({
      ok: false,
      message: e.forbidden,
      code: null,
    });
  });

  it("a draft that is not ready (422) points at the Payment card's list", async () => {
    api.completeDraftOrder.mockResolvedValue({
      outcome: "invalid",
      message: "This draft order is not ready",
      fields: [{ field: "email", message: "required" }],
    });
    expect(await completeDraftOrderAction(DRAFT_ID, "paid")).toMatchObject({
      ok: false,
      message: e.notReady,
    });
  });

  it("speaks Egyptian Arabic when the merchant reads Arabic", async () => {
    cookieLocale.value = "ar";
    api.completeDraftOrder.mockResolvedValue({ outcome: "conflict", message: "OUT_OF_STOCK: x" });
    expect(await completeDraftOrderAction(DRAFT_ID, "paid")).toMatchObject({
      message: ar.draftOrders.editor.errors.outOfStock,
    });
  });

  it("answers the order on success and refreshes the lists", async () => {
    api.completeDraftOrder.mockResolvedValue({
      outcome: "ok",
      data: { orderId: "o-1", orderNumber: "1001" },
    });
    expect(await completeDraftOrderAction(DRAFT_ID, "paid")).toEqual({ ok: true, orderId: "o-1" });
    expect(revalidatePath).toHaveBeenCalledWith("/orders");
  });

  it("refuses an unknown payment choice without calling the API", async () => {
    expect(await completeDraftOrderAction(DRAFT_ID, "cash" as unknown as "paid")).toMatchObject({
      ok: false,
    });
    expect(api.completeDraftOrder).not.toHaveBeenCalled();
  });
});

describe("saveDraftOrderAction", () => {
  it("creates with a fresh key, and replaces with the version", async () => {
    api.createDraftOrder.mockResolvedValue({ outcome: "ok", data: { id: DRAFT_ID } });
    expect(await saveDraftOrderAction(null, null, INPUT)).toMatchObject({ ok: true });
    expect(api.createDraftOrder).toHaveBeenCalledWith(INPUT, expect.stringMatching(UUID));
    api.updateDraftOrder.mockResolvedValue({ outcome: "ok", data: { id: DRAFT_ID } });
    await saveDraftOrderAction(DRAFT_ID, 2, INPUT);
    expect(api.updateDraftOrder).toHaveBeenCalledWith(
      DRAFT_ID,
      { ...INPUT, version: 2 },
      expect.stringMatching(UUID),
    );
  });

  it("returns field errors and flags a version conflict", async () => {
    api.updateDraftOrder.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid",
      fields: [{ field: "lines.0", message: "gone" }],
    });
    expect(await saveDraftOrderAction(DRAFT_ID, 2, INPUT)).toMatchObject({
      ok: false,
      message: e.invalid,
      fields: { "lines.0": "gone" },
      conflict: false,
    });
    api.updateDraftOrder.mockResolvedValue({
      outcome: "conflict",
      message: "VERSION_CONFLICT: changed",
    });
    expect(await saveDraftOrderAction(DRAFT_ID, 2, INPUT)).toMatchObject({
      ok: false,
      message: e.conflict,
      conflict: true,
    });
  });

  it("refuses an update with no version without calling the API", async () => {
    expect(await saveDraftOrderAction(DRAFT_ID, null, INPUT)).toMatchObject({ ok: false });
    expect(api.updateDraftOrder).not.toHaveBeenCalled();
  });
});

describe("the other draft actions", () => {
  it("delete goes back to the Drafts list", async () => {
    redirect.mockImplementation((to: string) => {
      throw new Error(`REDIRECT ${to}`);
    });
    api.deleteDraftOrder.mockResolvedValue({ outcome: "ok", data: { draftId: DRAFT_ID } });
    await expect(deleteDraftOrderAction(DRAFT_ID)).rejects.toThrow("REDIRECT /draft-orders");
    expect(api.deleteDraftOrder).toHaveBeenCalledWith(DRAFT_ID, expect.stringMatching(UUID));
  });

  it("shipping rates send no key and answer the rates", async () => {
    const rates = [{ method: "standard", title: "Standard", amountMinor: 500 }];
    api.fetchDraftShippingRates.mockResolvedValue({ outcome: "ok", data: { rates } });
    expect(await draftShippingRatesAction(DRAFT_ID)).toEqual({ ok: true, rates });
    expect(api.fetchDraftShippingRates.mock.calls[0]).toEqual([DRAFT_ID]);
  });

  it("product search offers only what a draft can sell (published or unlisted)", async () => {
    api.fetchProductsPage.mockResolvedValue({
      outcome: "ok",
      items: [
        {
          id: "p-1",
          name: "Tee",
          status: "published",
          variantCount: 2,
          priceAmountMinor: 25000,
          currency: "EGP",
          featuredImage: { url: "https://img/tee.jpg" },
        },
        { id: "p-2", name: "Old", status: "archived", variantCount: 1 },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    expect(await searchDraftProductsAction("  tee ")).toEqual([
      {
        id: "p-1",
        title: "Tee",
        imageUrl: "https://img/tee.jpg",
        variantCount: 2,
        priceMinor: 25000,
        currency: "EGP",
      },
    ]);
    expect(api.fetchProductsPage).toHaveBeenCalledWith({ first: 20, query: "tee" });
  });

  it("a product's variants carry their option names, SKU, price and picture", async () => {
    api.fetchProduct.mockResolvedValue({
      outcome: "ok",
      product: {
        id: "p-1",
        name: "Tee",
        options: [{ name: "Size" }, { name: "Color" }],
        media: [
          { id: "m-1", url: "https://img/1.jpg" },
          { id: "m-2", url: "https://img/2.jpg" },
        ],
        variants: [
          {
            id: "v-1",
            sku: "TEE-M-R",
            priceAmountMinor: 25000,
            currency: "EGP",
            selection: { Size: "M", Color: "Red" },
            imageId: "m-2",
          },
          {
            id: "v-2",
            sku: "TEE",
            priceAmountMinor: 20000,
            currency: "EGP",
            selection: null,
          },
        ],
      },
    });
    expect(await draftProductVariantsAction("p-1")).toEqual([
      {
        productId: "p-1",
        variantId: "v-1",
        title: "Tee",
        variantTitle: "M / Red",
        sku: "TEE-M-R",
        priceMinor: 25000,
        currency: "EGP",
        imageUrl: "https://img/2.jpg",
      },
      {
        productId: "p-1",
        variantId: "v-2",
        title: "Tee",
        variantTitle: null,
        sku: "TEE",
        priceMinor: 20000,
        currency: "EGP",
        imageUrl: "https://img/1.jpg",
      },
    ]);
  });

  it("customer search waits for two characters", async () => {
    expect(await searchDraftCustomersAction("a")).toEqual([]);
    expect(api.fetchCustomersPage).not.toHaveBeenCalled();
    api.fetchCustomersPage.mockResolvedValue({
      outcome: "ok",
      items: [{ id: "c-1", name: "Mona", email: "mona@example.com" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    expect(await searchDraftCustomersAction(" mo ")).toEqual([
      { id: "c-1", name: "Mona", email: "mona@example.com" },
    ]);
    expect(api.fetchCustomersPage).toHaveBeenCalledWith({ first: 10, search: "mo" });
  });
});
