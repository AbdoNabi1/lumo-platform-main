import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";

const api = vi.hoisted(() => ({
  changeMyPlan: vi.fn(),
  payMyInvoice: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());
const cookieValue = vi.hoisted(() => ({ locale: undefined as string | undefined }));

vi.mock("@/lib/api/store-billing", () => api);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: () => (cookieValue.locale === undefined ? undefined : { value: cookieValue.locale }),
    }),
}));

const { changeMyPlanAction, payMyInvoiceAction } = await import("./actions");
const { en } = await import("@/messages/en");
const { ar } = await import("@/messages/ar");

const idle: FormState = { status: "idle" };

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.append(name, value);
  return formData;
}

beforeEach(() => {
  cookieValue.locale = undefined;
  api.changeMyPlan.mockReset().mockResolvedValue({ outcome: "ok", data: { id: "sub1" } });
  api.payMyInvoice
    .mockReset()
    .mockResolvedValue({ outcome: "ok", data: { checkoutUrl: "https://pay.example.com/c/1" } });
  revalidatePath.mockReset();
  redirect.mockReset();
});

describe("changeMyPlanAction", () => {
  it("changes the plan with one idempotency key and refreshes the page", async () => {
    const state = await changeMyPlanAction(idle, form({ planKey: "growth" }));

    expect(state).toEqual({ status: "success" });
    expect(api.changeMyPlan).toHaveBeenCalledTimes(1);
    expect(api.changeMyPlan).toHaveBeenCalledWith("growth", expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/settings/billing");
  });

  it("refuses a missing plan key before any request", async () => {
    const state = await changeMyPlanAction(idle, form({}));

    expect(state).toMatchObject({ status: "error", message: en.formErrors.invalid });
    expect(api.changeMyPlan).not.toHaveBeenCalled();
  });

  it("projects a not-found plan onto the generic message, in the merchant's language", async () => {
    cookieValue.locale = "ar";
    api.changeMyPlan.mockResolvedValue({ outcome: "not_found" });

    const state = await changeMyPlanAction(idle, form({ planKey: "gone" }));

    expect(state).toMatchObject({ status: "error", message: ar.formErrors.notFound });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("payMyInvoiceAction", () => {
  it("redirects to an https checkout url", async () => {
    await payMyInvoiceAction(idle, form({ invoiceId: "inv1" }));

    expect(api.payMyInvoice).toHaveBeenCalledWith("inv1", expect.any(String));
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("https://pay.example.com/c/1");
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["http:", "http://pay.example.com/c/1"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["a relative path", "/settings"],
    ["garbage", "not a url"],
    ["empty", ""],
  ])("never redirects to %s and reports a checkout error", async (_label, checkoutUrl) => {
    api.payMyInvoice.mockResolvedValue({ outcome: "ok", data: { checkoutUrl } });

    const state = await payMyInvoiceAction(idle, form({ invoiceId: "inv1" }));

    expect(redirect).not.toHaveBeenCalled();
    expect(state).toMatchObject({ status: "error", message: en.billingPage.errorCheckout });
  });

  it("says the invoice is no longer available on a 404", async () => {
    api.payMyInvoice.mockResolvedValue({ outcome: "not_found" });

    const state = await payMyInvoiceAction(idle, form({ invoiceId: "inv1" }));

    expect(state).toMatchObject({ status: "error", message: en.billingPage.errorInvoiceGone });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("answers in Arabic when the locale cookie says so", async () => {
    cookieValue.locale = "ar";
    api.payMyInvoice.mockResolvedValue({ outcome: "not_found" });

    const state = await payMyInvoiceAction(idle, form({ invoiceId: "inv1" }));

    expect(state).toMatchObject({ message: ar.billingPage.errorInvoiceGone });
  });

  it("projects other failures through the shared form messages", async () => {
    api.payMyInvoice.mockResolvedValue({ outcome: "error", message: "boom" });

    const state = await payMyInvoiceAction(idle, form({ invoiceId: "inv1" }));

    expect(state).toMatchObject({ status: "error", message: en.formErrors.unexpected });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("does nothing without an invoice id", async () => {
    const state = await payMyInvoiceAction(idle, form({}));

    expect(state.status).toBe("error");
    expect(api.payMyInvoice).not.toHaveBeenCalled();
  });
});
