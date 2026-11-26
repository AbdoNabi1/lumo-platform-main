import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutSettingsSaveState } from "@/lib/checkout-settings-save";

const api = vi.hoisted(() => ({
  fetchCheckoutSettings: vi.fn(),
  saveCheckoutSettings: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/checkout-settings", () => ({
  fetchCheckoutSettings: api.fetchCheckoutSettings,
  saveCheckoutSettings: api.saveCheckoutSettings,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { saveCheckoutSettingsAction } = await import("./actions");
const { en } = await import("@/messages/en");

const idle: CheckoutSettingsSaveState = { status: "idle" };

const STORED = {
  nameMode: "required",
  phoneMode: "required",
  line2Mode: "optional",
  marketingEmailPrompt: "hidden",
  cartLineLimit: null,
  requireLogin: false,
  accountsMode: "disabled",
  showAccountLink: false,
  version: 2,
} as const;

function form(entries: Record<string, string | undefined>): FormData {
  const formData = new FormData();
  const fields: Record<string, string | undefined> = {
    expectedVersion: "2",
    nameMode: "required",
    phoneMode: "required",
    line2Mode: "optional",
    marketingEmailPrompt: "hidden",
    ...entries,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) formData.append(key, value);
  }
  return formData;
}

beforeEach(() => {
  api.fetchCheckoutSettings.mockReset().mockResolvedValue({ outcome: "ok", settings: STORED });
  api.saveCheckoutSettings
    .mockReset()
    .mockResolvedValue({ outcome: "ok", data: { ...STORED, version: 3 } });
  revalidatePath.mockReset();
});

function refreshed(): string[] {
  return revalidatePath.mock.calls.map((call) => String(call[0])).sort();
}

describe("saveCheckoutSettingsAction (Wave 2a)", () => {
  it("sends this page's switches, keeps the accounts switches as read, with the loaded version", async () => {
    expect.hasAssertions();
    const state = await saveCheckoutSettingsAction(
      idle,
      form({
        nameMode: "optional",
        phoneMode: "optional",
        line2Mode: "hidden",
        marketingEmailPrompt: "show",
        cartLimitOn: "on",
        cartLineLimit: "5",
      }),
    );

    expect(state).toEqual({ status: "success", version: 3 });
    expect(api.saveCheckoutSettings).toHaveBeenCalledTimes(1);
    expect(api.saveCheckoutSettings).toHaveBeenCalledWith(
      {
        nameMode: "optional",
        phoneMode: "optional",
        line2Mode: "hidden",
        marketingEmailPrompt: "show",
        cartLineLimit: 5,
        requireLogin: false,
        accountsMode: "disabled",
        showAccountLink: false,
      },
      2,
      expect.any(String),
    );
    expect(refreshed()).toEqual(["/settings/checkout", "/settings/customer-accounts"]);
  });

  it("sends the version the page loaded, not the freshly read one", async () => {
    expect.hasAssertions();
    await saveCheckoutSettingsAction(idle, form({ expectedVersion: "1" }));

    expect(api.saveCheckoutSettings.mock.calls[0]?.[1]).toBe(1);
  });

  it("sends expectedVersion null when the page loaded the defaults (empty field)", async () => {
    expect.hasAssertions();
    api.fetchCheckoutSettings.mockResolvedValue({
      outcome: "ok",
      settings: { ...STORED, accountsMode: "optional", version: null },
    });

    await saveCheckoutSettingsAction(idle, form({ expectedVersion: "" }));

    expect(api.saveCheckoutSettings.mock.calls[0]?.[1]).toBeNull();
  });

  it("turns the switches into booleans and an unticked limit into null", async () => {
    expect.hasAssertions();
    api.fetchCheckoutSettings.mockResolvedValue({
      outcome: "ok",
      settings: { ...STORED, accountsMode: "optional", cartLineLimit: 7 },
    });

    await saveCheckoutSettingsAction(idle, form({ requireLogin: "on", cartLineLimit: "9" }));

    expect(api.saveCheckoutSettings.mock.calls[0]?.[0]).toMatchObject({
      requireLogin: true,
      cartLineLimit: null,
    });
  });

  it.each(["", "abc", "1.5", "0", "1000", "-3", "1e2"])(
    "refuses the typed limit %j before any request (NaN would travel as null = no limit)",
    async (typed) => {
      expect.hasAssertions();
      const state = await saveCheckoutSettingsAction(
        idle,
        form({ cartLimitOn: "on", cartLineLimit: typed }),
      );

      expect(state).toMatchObject({
        status: "error",
        fieldErrors: { cartLineLimit: "Enter a whole number from 1 to 999." },
      });
      expect(api.fetchCheckoutSettings).not.toHaveBeenCalled();
      expect(api.saveCheckoutSettings).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["nameMode", "hidden"],
    ["phoneMode", "hidden"],
    ["line2Mode", "maybe"],
    ["marketingEmailPrompt", "always"],
  ])("refuses %s = %s without any request", async (field, value) => {
    expect.hasAssertions();
    const state = await saveCheckoutSettingsAction(idle, form({ [field]: value }));

    expect(state).toMatchObject({ status: "error", fieldErrors: { [field]: expect.any(String) } });
    expect(api.saveCheckoutSettings).not.toHaveBeenCalled();
  });

  it.each([undefined, "abc", "0", "-1"])(
    "refuses a missing or tampered version %j without any request",
    async (version) => {
      expect.hasAssertions();
      const state = await saveCheckoutSettingsAction(idle, form({ expectedVersion: version }));

      expect(state.status).toBe("error");
      expect(api.fetchCheckoutSettings).not.toHaveBeenCalled();
    },
  );

  it("maps a 409 to the reload message and still refreshes both pages", async () => {
    expect.hasAssertions();
    api.saveCheckoutSettings.mockResolvedValue({
      outcome: "conflict",
      message: "These settings were changed by someone else",
    });

    const state = await saveCheckoutSettingsAction(idle, form({}));

    expect(state).toEqual({
      status: "error",
      message: "These settings were changed by someone else. Reload to see the latest version.",
      fieldErrors: {},
    });
    expect(state.status === "error" && state.message).toBe(en.checkoutSettings.conflict);
    expect(refreshed()).toEqual(["/settings/checkout", "/settings/customer-accounts"]);
  });

  it("maps a 422 to field errors (the server's requireLogin message) and refreshes", async () => {
    expect.hasAssertions();
    api.saveCheckoutSettings.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid checkout settings",
      fields: [{ field: "requireLogin", message: "Customer accounts must be on to require login" }],
    });

    const state = await saveCheckoutSettingsAction(idle, form({ requireLogin: "on" }));

    expect(state).toMatchObject({
      status: "error",
      message: expect.any(String),
      fieldErrors: { requireLogin: "Customer accounts must be on to require login" },
    });
    expect(refreshed()).toEqual(["/settings/checkout", "/settings/customer-accounts"]);
  });

  it.each(["unauthorized", "forbidden", "not_found", "error"] as const)(
    "refreshes both pages after a %s save and returns an error",
    async (outcome) => {
      expect.hasAssertions();
      api.saveCheckoutSettings.mockResolvedValue({ outcome, message: "x" });

      const state = await saveCheckoutSettingsAction(idle, form({}));

      expect(state.status).toBe("error");
      expect(refreshed()).toEqual(["/settings/checkout", "/settings/customer-accounts"]);
    },
  );

  it("never writes when the read of the current settings fails, and refreshes", async () => {
    expect.hasAssertions();
    api.fetchCheckoutSettings.mockResolvedValue({ outcome: "unauthorized" });

    const state = await saveCheckoutSettingsAction(idle, form({}));

    expect(state.status).toBe("error");
    expect(api.saveCheckoutSettings).not.toHaveBeenCalled();
    expect(refreshed()).toEqual(["/settings/checkout", "/settings/customer-accounts"]);
  });
});
