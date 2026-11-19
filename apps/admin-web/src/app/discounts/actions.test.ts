import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as DiscountsModule from "@/lib/api/discounts";
import type { FormState } from "@/lib/api/mutation";
import { emptyFormValues } from "@/lib/discounts/form";

const discounts = vi.hoisted(() => ({
  createDiscount: vi.fn(),
  updateDiscount: vi.fn(),
  deleteDiscount: vi.fn(),
  activateDiscount: vi.fn(),
  deactivateDiscount: vi.fn(),
}));
const products = vi.hoisted(() => ({ fetchProductsPage: vi.fn() }));
const categories = vi.hoisted(() => ({ fetchCategoriesPage: vi.fn() }));
const customers = vi.hoisted(() => ({ fetchCustomersPage: vi.fn() }));
const revalidatePath = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
);
const locale = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("@/lib/api/discounts", async (importOriginal) => ({
  ...(await importOriginal<typeof DiscountsModule>()),
  ...discounts,
}));
vi.mock("@/lib/api/products", () => products);
vi.mock("@/lib/api/categories", () => categories);
vi.mock("@/lib/api/customers", () => customers);
vi.mock("@/lib/api/store-settings", () => ({
  storeSettingsOrDefaults: () =>
    Promise.resolve({
      storeName: "",
      contactEmail: null,
      currency: "EGP",
      timezone: "Asia/Dubai",
      weightUnit: "kg",
    }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({ get: () => (locale.value ? { value: locale.value } : undefined) }),
}));

const {
  deleteDiscountAction,
  saveDiscountAction,
  searchDiscountTargetsAction,
  setDiscountActiveAction,
} = await import("./actions");

const idle: FormState = { status: "idle" };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const sale10 = {
  ...emptyFormValues("amount_off_order", new Date("2026-10-16T10:30:00.000Z"), "Asia/Dubai"),
  code: "sale10",
  valueAmount: "10",
  minimumKind: "amount" as const,
  minimumAmount: "200",
};

beforeEach(() => {
  for (const fn of Object.values(discounts)) fn.mockReset();
  products.fetchProductsPage.mockReset();
  categories.fetchCategoriesPage.mockReset();
  customers.fetchCustomersPage.mockReset();
  revalidatePath.mockReset();
  redirect.mockClear();
  locale.value = undefined;
});

describe("saveDiscountAction", () => {
  it("creates the discount in the store's currency and zone, then opens it", async () => {
    discounts.createDiscount.mockResolvedValue({ outcome: "ok", data: { id: "promo-9" } });

    await expect(
      saveDiscountAction(idle, form({ payload: JSON.stringify(sale10) })),
    ).rejects.toThrow("NEXT_REDIRECT:/discounts/promo-9");

    const [input, key] = discounts.createDiscount.mock.calls[0]!;
    expect(input).toMatchObject({
      code: "SALE10",
      value: { kind: "percentage", amount: 10 },
      minimumRequirement: { kind: "amount", amountMinor: 20000 },
      startsAt: "2026-10-16T10:30:00.000Z",
    });
    expect(typeof key).toBe("string");
    expect(revalidatePath).toHaveBeenCalledWith("/discounts");
  });

  it("updates an existing discount and stays on it", async () => {
    discounts.updateDiscount.mockResolvedValue({ outcome: "ok", data: { id: "promo-1" } });

    const state = await saveDiscountAction(
      idle,
      form({ payload: JSON.stringify(sale10), discountId: "promo-1" }),
    );

    expect(state).toEqual({ status: "success" });
    expect(discounts.updateDiscount).toHaveBeenCalledWith(
      "promo-1",
      expect.any(Object),
      expect.any(String),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/discounts/promo-1");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("answers the form's own errors without calling the API", async () => {
    const state = await saveDiscountAction(
      idle,
      form({ payload: JSON.stringify({ ...sale10, code: "", valueAmount: "500" }) }),
    );

    expect(state).toEqual({
      status: "error",
      message: "The discount wasn't saved. Check the highlighted fields.",
      fieldErrors: { code: "Required.", value: "Enter a percentage above 0 and up to 100." },
    });
    expect(discounts.createDiscount).not.toHaveBeenCalled();
  });

  it("rejects a forged payload without calling the API", async () => {
    for (const payload of ["not json", JSON.stringify({ type: "bogus" }), ""]) {
      const state = await saveDiscountAction(idle, form({ payload }));
      expect(state.status).toBe("error");
    }
    expect(discounts.createDiscount).not.toHaveBeenCalled();
  });

  it("shows a taken code under the code field, in Arabic too", async () => {
    locale.value = "ar";
    discounts.createDiscount.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid discount",
      fields: [
        { field: "code", message: "This code is already in use" },
        { field: "gets.effect.value", message: "at most 100" },
      ],
    });

    const state = await saveDiscountAction(idle, form({ payload: JSON.stringify(sale10) }));

    expect(state).toEqual({
      status: "error",
      message: "لم يُحفظ الخصم. راجع الحقول المحددة.",
      fieldErrors: { code: "هذا الكود مستخدم بالفعل.", gets: "راجع هذا الحقل." },
    });
  });

  it("passes other failures through the shared form errors", async () => {
    discounts.createDiscount.mockResolvedValue({ outcome: "forbidden" });
    const state = await saveDiscountAction(idle, form({ payload: JSON.stringify(sale10) }));
    expect(state.status).toBe("error");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteDiscountAction", () => {
  it("deletes and goes back to the list", async () => {
    discounts.deleteDiscount.mockResolvedValue({ outcome: "ok", data: {} });
    await expect(deleteDiscountAction(idle, form({ discountId: "promo-1" }))).rejects.toThrow(
      "NEXT_REDIRECT:/discounts",
    );
    expect(discounts.deleteDiscount).toHaveBeenCalledWith("promo-1", expect.any(String));
  });

  it("needs an id", async () => {
    expect((await deleteDiscountAction(idle, form({}))).status).toBe("error");
    expect(discounts.deleteDiscount).not.toHaveBeenCalled();
  });
});

describe("setDiscountActiveAction", () => {
  it("deactivates and activates", async () => {
    discounts.deactivateDiscount.mockResolvedValue({ outcome: "ok", data: {} });
    discounts.activateDiscount.mockResolvedValue({ outcome: "ok", data: {} });

    expect(
      await setDiscountActiveAction(idle, form({ discountId: "promo-1", active: "false" })),
    ).toEqual({
      status: "success",
    });
    expect(
      await setDiscountActiveAction(idle, form({ discountId: "promo-1", active: "true" })),
    ).toEqual({
      status: "success",
    });
    expect(discounts.deactivateDiscount).toHaveBeenCalledWith("promo-1", expect.any(String));
    expect(discounts.activateDiscount).toHaveBeenCalledWith("promo-1", expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/discounts/promo-1");
  });
});

describe("searchDiscountTargetsAction", () => {
  it("searches products by name or SKU", async () => {
    products.fetchProductsPage.mockResolvedValue({
      outcome: "ok",
      items: [{ id: "p-1", name: "Sneaker", sku: "SNK-1" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    });

    expect(await searchDiscountTargetsAction("products", " snk ")).toEqual({
      outcome: "ok",
      items: [{ id: "p-1", label: "Sneaker", detail: "SNK-1" }],
    });
    expect(products.fetchProductsPage).toHaveBeenCalledWith({ first: 25, query: "snk" });
  });

  it("filters categories by name", async () => {
    categories.fetchCategoriesPage.mockResolvedValue({
      outcome: "ok",
      items: [
        { id: "c-1", name: "Shoes", slug: "shoes", parentId: null },
        { id: "c-2", name: "Bags", slug: "bags", parentId: null },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    });

    expect(await searchDiscountTargetsAction("categories", "sho")).toEqual({
      outcome: "ok",
      items: [{ id: "c-1", label: "Shoes", detail: null }],
    });
  });

  it("searches customers by name or email, and reports failures", async () => {
    customers.fetchCustomersPage.mockResolvedValueOnce({
      outcome: "ok",
      items: [{ id: "cus-1", name: "Mona", email: "mona@example.com" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    expect(await searchDiscountTargetsAction("customers", "mona")).toEqual({
      outcome: "ok",
      items: [{ id: "cus-1", label: "Mona", detail: "mona@example.com" }],
    });

    customers.fetchCustomersPage.mockResolvedValueOnce({ outcome: "error", message: "down" });
    expect(await searchDiscountTargetsAction("customers", "")).toEqual({ outcome: "error" });
  });

  it("refuses an unknown kind", async () => {
    expect(await searchDiscountTargetsAction("orders" as unknown as "products", "x")).toEqual({
      outcome: "error",
    });
  });
});
