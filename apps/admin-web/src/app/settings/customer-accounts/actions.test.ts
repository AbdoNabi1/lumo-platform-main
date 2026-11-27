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

const { saveCustomerAccountsAction } = await import("./actions");

const idle: CheckoutSettingsSaveState = { status: "idle" };

const STORED = {
  nameMode: "optional",
  phoneMode: "optional",
  line2Mode: "required",
  marketingEmailPrompt: "show",
  cartLineLimit: 4,
  requireLogin: true,
  accountsMode: "optional",
  showAccountLink: true,
  version: 6,
} as const;

function form(entries: Record<string, string | undefined>): FormData {
  const formData = new FormData();
  const fields: Record<string, string | undefined> = {
    expectedVersion: "6",
    accountsMode: "optional",
    ...entries,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) formData.append(key, value);
  }
  return formData;
}

function refreshed(): string[] {
  return revalidatePath.mock.calls.map((call) => String(call[0])).sort();
}

beforeEach(() => {
  api.fetchCheckoutSettings.mockReset().mockResolvedValue({ outcome: "ok", settings: STORED });
  api.saveCheckoutSettings
    .mockReset()
    .mockResolvedValue({ outcome: "ok", data: { ...STORED, version: 7 } });
  revalidatePath.mockReset();
});

describe("saveCustomerAccountsAction (Wave 2a)", () => {
  it("sends the accounts switches and keeps the Checkout switches (incl. require login) as read", async () => {
    expect.hasAssertions();
    const state = await saveCustomerAccountsAction(idle, form({ showAccountLink: "on" }));

    expect(state).toEqual({ status: "success", version: 7 });
    expect(api.saveCheckoutSettings).toHaveBeenCalledWith(
      {
        nameMode: "optional",
        phoneMode: "optional",
        line2Mode: "required",
        marketingEmailPrompt: "show",
        cartLineLimit: 4,
        requireLogin: true,
        accountsMode: "optional",
        showAccountLink: true,
      },
      6,
      expect.any(String),
    );
    expect(refreshed()).toEqual(["/settings/checkout", "/settings/customer-accounts"]);
  });

  it("an unticked link switch posts nothing and is saved as false", async () => {
    expect.hasAssertions();
    await saveCustomerAccountsAction(idle, form({}));

    expect(api.saveCheckoutSettings.mock.calls[0]?.[0]).toMatchObject({ showAccountLink: false });
  });

  it("sends accounts off with require login off (nothing to refuse)", async () => {
    expect.hasAssertions();
    api.fetchCheckoutSettings.mockResolvedValue({
      outcome: "ok",
      settings: { ...STORED, requireLogin: false },
    });

    await saveCustomerAccountsAction(idle, form({ accountsMode: "disabled" }));

    expect(api.saveCheckoutSettings.mock.calls[0]?.[0]).toMatchObject({
      accountsMode: "disabled",
      requireLogin: false,
    });
  });

  it("shows the server's 422 on requireLogin when accounts go off while login is required", async () => {
    expect.hasAssertions();
    api.saveCheckoutSettings.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid checkout settings",
      fields: [{ field: "requireLogin", message: "Customer accounts must be on to require login" }],
    });

    const state = await saveCustomerAccountsAction(idle, form({ accountsMode: "disabled" }));

    expect(state).toMatchObject({
      status: "error",
      fieldErrors: { requireLogin: "Customer accounts must be on to require login" },
    });
    expect(refreshed()).toEqual(["/settings/checkout", "/settings/customer-accounts"]);
  });

  it("maps a 409 to the reload message and refreshes both pages", async () => {
    expect.hasAssertions();
    api.saveCheckoutSettings.mockResolvedValue({ outcome: "conflict", message: "stale" });

    const state = await saveCustomerAccountsAction(idle, form({}));

    expect(state).toEqual({
      status: "error",
      message: "These settings were changed by someone else. Reload to see the latest version.",
      fieldErrors: {},
    });
    expect(refreshed()).toEqual(["/settings/checkout", "/settings/customer-accounts"]);
  });

  it("sends expectedVersion null for a shop with no row yet", async () => {
    expect.hasAssertions();
    await saveCustomerAccountsAction(idle, form({ expectedVersion: "" }));

    expect(api.saveCheckoutSettings.mock.calls[0]?.[1]).toBeNull();
  });

  it("refuses a tampered accounts mode or version without any request", async () => {
    expect.hasAssertions();
    const badMode = await saveCustomerAccountsAction(idle, form({ accountsMode: "required" }));
    const badVersion = await saveCustomerAccountsAction(idle, form({ expectedVersion: "x" }));

    expect(badMode.status).toBe("error");
    expect(badVersion.status).toBe("error");
    expect(api.fetchCheckoutSettings).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(["unauthorized", "forbidden", "not_found", "error"] as const)(
    "refreshes both pages after a %s save",
    async (outcome) => {
      expect.hasAssertions();
      api.saveCheckoutSettings.mockResolvedValue({ outcome, message: "x" });

      const state = await saveCustomerAccountsAction(idle, form({}));

      expect(state.status).toBe("error");
      expect(refreshed()).toEqual(["/settings/checkout", "/settings/customer-accounts"]);
    },
  );
});
