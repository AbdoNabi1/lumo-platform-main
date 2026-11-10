import { beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const api = vi.hoisted(() => ({ updatePolicy: vi.fn(), generatePolicyTemplate: vi.fn() }));
const revalidate = vi.hoisted(() => ({ revalidateStorefront: vi.fn(), revalidatePath: vi.fn() }));
const locale = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("@/lib/api/online-store", () => api);
vi.mock("@/lib/storefront-revalidate", () => ({
  revalidateStorefront: revalidate.revalidateStorefront,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidate.revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (locale.value === undefined ? undefined : { value: locale.value }),
    }),
}));
const { generatePolicyTemplateAction, savePolicyAction } = await import("./actions");

const inputs = {
  storeName: "Nour",
  contactEmail: "",
  contactPhone: "",
  businessAddress: "",
  returnWindowDays: 14,
  returnShippingPaidBy: "customer" as const,
  refundMethod: "original" as const,
  cashOnDelivery: true,
  deliveryDays: { min: 2, max: 5 },
  shipsInternationally: false,
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  revalidate.revalidateStorefront.mockReset().mockResolvedValue(true);
  revalidate.revalidatePath.mockReset();
  locale.value = undefined;
});

describe("policy actions (spec 2.3)", () => {
  it("save sends the body and the version with one key, then revalidates the storefront", async () => {
    api.updatePolicy.mockResolvedValue({
      outcome: "ok",
      data: { type: "refund", body: {}, updatedAt: null, version: 2 },
    });
    expect(await savePolicyAction("refund", { body: { ar: "نص" }, expectedVersion: 1 })).toEqual({
      status: "success",
      version: 2,
    });
    expect(api.updatePolicy).toHaveBeenCalledWith(
      "refund",
      { body: { ar: "نص" }, expectedVersion: 1 },
      expect.any(String),
    );
    expect(revalidate.revalidateStorefront).toHaveBeenCalledTimes(1);
    expect(revalidate.revalidatePath).toHaveBeenCalledWith("/settings/policies");
  });

  it("each save gets its own idempotency key; a refused revalidation still saves (liveDelayed)", async () => {
    api.updatePolicy.mockResolvedValue({
      outcome: "ok",
      data: { type: "terms", body: {}, updatedAt: null, version: 5 },
    });
    revalidate.revalidateStorefront.mockResolvedValue(false);
    const input = { body: { en: "x" }, expectedVersion: 4 };
    expect(await savePolicyAction("terms", input)).toEqual({
      status: "success",
      liveDelayed: true,
      version: 5,
    });
    await savePolicyAction("terms", input);
    const keys = api.updatePolicy.mock.calls.map((call) => call[2] as string);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("UNSAFE_LINK and TOO_LONG land on the locale's field", async () => {
    api.updatePolicy.mockResolvedValue({
      outcome: "invalid",
      message: "INVALID_CONTENT: Check the highlighted fields.",
      fields: [
        { field: "body.en", message: "UNSAFE_LINK" },
        { field: "body.ar", message: "TOO_LONG" },
      ],
    });
    const state = await savePolicyAction("refund", { body: { en: "x" }, expectedVersion: 1 });
    expect(state).toMatchObject({
      status: "error",
      fieldErrors: {
        "body.en": en.richText.unsafeLinkSaved,
        "body.ar": en.onlineStorePreferences.tooLong,
      },
    });
    expect(revalidate.revalidateStorefront).not.toHaveBeenCalled();
  });

  it("a lost race is the localised reload copy, in the admin's language", async () => {
    locale.value = "ar";
    api.updatePolicy.mockResolvedValue({
      outcome: "conflict",
      message: "VERSION_CONFLICT: This was changed in another window.",
    });
    expect(await savePolicyAction("privacy", { body: {}, expectedVersion: 1 })).toEqual({
      status: "error",
      message: ar.onlineStorePreferences.conflict,
      fieldErrors: {},
    });
  });

  it("refuses an unknown type, a bad version or a malformed body without calling the API", async () => {
    // @ts-expect-error -- an untrusted caller
    expect(await savePolicyAction("returns", { body: {}, expectedVersion: 1 })).toMatchObject({
      status: "error",
    });
    expect(await savePolicyAction("refund", { body: {}, expectedVersion: -1 })).toMatchObject({
      status: "error",
    });
    expect(
      // @ts-expect-error -- an untrusted caller
      await savePolicyAction("refund", { body: { ar: 3 }, expectedVersion: 1 }),
    ).toMatchObject({ status: "error" });
    expect(api.updatePolicy).not.toHaveBeenCalled();
  });

  it("the template action sends no idempotency key and returns the text", async () => {
    api.generatePolicyTemplate.mockResolvedValue({ outcome: "ok", data: { body: "x" } });
    expect(await generatePolicyTemplateAction("shipping", "en", inputs)).toEqual({
      status: "ok",
      body: "x",
    });
    expect(api.generatePolicyTemplate).toHaveBeenCalledWith("shipping", { locale: "en", inputs });
    expect(api.generatePolicyTemplate.mock.calls[0]).toHaveLength(2);
    expect(revalidate.revalidateStorefront).not.toHaveBeenCalled();
  });

  it("a refused template answer is our own copy, never the server's text", async () => {
    api.generatePolicyTemplate.mockResolvedValue({
      outcome: "invalid",
      message: "INVALID_CONTENT: Check the highlighted fields.",
      fields: [{ field: "inputs.returnWindowDays", message: "OUT_OF_RANGE" }],
    });
    expect(await generatePolicyTemplateAction("refund", "ar", inputs)).toEqual({
      status: "error",
      message: en.policies.templateInvalid,
    });
    api.generatePolicyTemplate.mockResolvedValue({ outcome: "forbidden" });
    expect(await generatePolicyTemplateAction("refund", "ar", inputs)).toEqual({
      status: "error",
      message: en.formErrors.forbidden,
    });
    // @ts-expect-error -- an untrusted caller
    expect(await generatePolicyTemplateAction("refund", "fr", inputs)).toMatchObject({
      status: "error",
    });
    expect(api.generatePolicyTemplate).toHaveBeenCalledTimes(2);
  });
});
