import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";

const payments = vi.hoisted(() => ({
  fetchPaymentSettings: vi.fn(),
  updateEnabledPaymentMethods: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/payments", () => ({
  fetchPaymentSettings: payments.fetchPaymentSettings,
  updateEnabledPaymentMethods: payments.updateEnabledPaymentMethods,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { savePaymentMethodsAction } = await import("./actions");

const idle: FormState = { status: "idle" };

function form(methods: readonly string[]): FormData {
  const formData = new FormData();
  for (const method of methods) formData.append("method", method);
  return formData;
}

beforeEach(() => {
  payments.fetchPaymentSettings.mockReset().mockResolvedValue({
    outcome: "ok",
    settings: {
      enabledMethods: ["stripe"],
      methods: { cod: { available: true }, stripe: { available: true, configured: true } },
    },
  });
  payments.updateEnabledPaymentMethods.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  revalidatePath.mockReset();
});

describe("savePaymentMethodsAction (Plan 3A)", () => {
  it("sends the ticked methods as enabledMethods with one idempotency key, then refreshes the page", async () => {
    const state = await savePaymentMethodsAction(idle, form(["cod", "stripe"]));

    expect(state).toEqual({ status: "success" });
    expect(payments.updateEnabledPaymentMethods).toHaveBeenCalledTimes(1);
    expect(payments.updateEnabledPaymentMethods).toHaveBeenCalledWith(
      ["cod", "stripe"],
      expect.any(String),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/settings/payments");
  });

  it("refuses an empty set without any API call", async () => {
    const state = await savePaymentMethodsAction(idle, form([]));

    expect(state.status).toBe("error");
    expect(payments.fetchPaymentSettings).not.toHaveBeenCalled();
    expect(payments.updateEnabledPaymentMethods).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("drops keys the platform does not register", async () => {
    await savePaymentMethodsAction(idle, form(["cod", "bitcoin"]));

    expect(payments.updateEnabledPaymentMethods).toHaveBeenCalledWith(["cod"], expect.any(String));
  });

  it("refuses when only unknown keys were sent, without calling the update", async () => {
    const state = await savePaymentMethodsAction(idle, form(["bitcoin"]));

    expect(state.status).toBe("error");
    expect(payments.updateEnabledPaymentMethods).not.toHaveBeenCalled();
  });

  it("maps a 422 to a form error", async () => {
    payments.updateEnabledPaymentMethods.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid",
      fields: [{ field: "enabledMethods", message: "cod is not available" }],
    });

    const state = await savePaymentMethodsAction(idle, form(["cod"]));

    expect(state).toMatchObject({
      status: "error",
      fieldErrors: { enabledMethods: "cod is not available" },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("maps a failed read of the platform's methods to a form error and never writes", async () => {
    payments.fetchPaymentSettings.mockResolvedValue({ outcome: "unauthorized" });

    const state = await savePaymentMethodsAction(idle, form(["cod"]));

    expect(state.status).toBe("error");
    expect(payments.updateEnabledPaymentMethods).not.toHaveBeenCalled();
  });
});
