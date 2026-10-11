import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";

const api = vi.hoisted(() => ({ updateStoreSettings: vi.fn() }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/store-settings", () => ({ updateStoreSettings: api.updateStoreSettings }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { saveStoreSettingsAction } = await import("./actions");

const idle: FormState = { status: "idle" };

function form(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  const fields = {
    storeName: "  Lumo  ",
    contactEmail: "hello@lumo.test",
    currency: "sar",
    timezone: "Asia/Riyadh",
    weightUnit: "g",
    ...overrides,
  };
  for (const [name, value] of Object.entries(fields)) formData.append(name, value);
  return formData;
}

beforeEach(() => {
  api.updateStoreSettings.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  revalidatePath.mockReset();
});

describe("saveStoreSettingsAction (Plan 3C)", () => {
  it("sends the trimmed settings with an upper-case currency and one idempotency key", async () => {
    const state = await saveStoreSettingsAction(idle, form());

    expect(state).toEqual({ status: "success" });
    expect(api.updateStoreSettings).toHaveBeenCalledTimes(1);
    expect(api.updateStoreSettings).toHaveBeenCalledWith(
      {
        storeName: "Lumo",
        contactEmail: "hello@lumo.test",
        currency: "SAR",
        timezone: "Asia/Riyadh",
        weightUnit: "g",
      },
      expect.any(String),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/settings/general");
  });

  it("sends no contact email when the field is blank", async () => {
    await saveStoreSettingsAction(idle, form({ contactEmail: "   " }));

    expect(api.updateStoreSettings.mock.calls[0]?.[0]).toMatchObject({ contactEmail: null });
  });

  it("refuses a weight unit it does not know, before any request", async () => {
    const state = await saveStoreSettingsAction(idle, form({ weightUnit: "stone" }));

    expect(state.status).toBe("error");
    expect(state.status === "error" && Object.keys(state.fieldErrors)).toEqual(["weightUnit"]);
    expect(api.updateStoreSettings).not.toHaveBeenCalled();
  });

  it("projects the API's validation errors onto the form", async () => {
    api.updateStoreSettings.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid store settings",
      fields: [{ field: "currency", message: "must be an ISO 4217 currency code" }],
    });

    const state = await saveStoreSettingsAction(idle, form());

    expect(state).toMatchObject({
      status: "error",
      fieldErrors: { currency: "must be an ISO 4217 currency code" },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a failed save (for example a failed price relabel) so the merchant can retry", async () => {
    api.updateStoreSettings.mockResolvedValue({ outcome: "error", message: "boom" });

    const state = await saveStoreSettingsAction(idle, form());

    expect(state.status).toBe("error");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
