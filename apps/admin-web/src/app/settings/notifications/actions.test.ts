import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS } from "@/components/settings/notifications/test-fixtures";

const api = vi.hoisted(() => ({
  fetchNotificationSettings: vi.fn(),
  saveNotificationSettings: vi.fn(),
  startSenderDomain: vi.fn(),
  verifySenderDomain: vi.fn(),
  previewTemplateCopy: vi.fn(),
  revertTemplateCopy: vi.fn(),
  saveTemplateCopy: vi.fn(),
  sendTemplateTest: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/notification-settings", () => api);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const actions = await import("./actions");
const { en } = await import("@/messages/en");

const copy = en.notificationSettings;

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  revalidatePath.mockReset();
  api.fetchNotificationSettings.mockResolvedValue({ outcome: "ok", settings: SETTINGS });
  api.saveNotificationSettings.mockResolvedValue({
    outcome: "ok",
    data: { ...SETTINGS, version: 4 },
  });
});

function refreshed(): string[] {
  return revalidatePath.mock.calls.map((call) => String(call[0])).sort();
}

describe("saveNotificationSettingsAction", () => {
  it("merges one part into the fresh document and sends the version the page LOADED", async () => {
    expect.hasAssertions();
    const result = await actions.saveNotificationSettingsAction({
      expectedVersion: 2,
      patch: { staffRecipients: ["Owner@Shop.example", "owner@shop.example"] },
    });

    expect(result).toEqual({ status: "success", settings: { ...SETTINGS, version: 4 } });
    expect(api.saveNotificationSettings).toHaveBeenCalledWith(
      {
        senderEmail: "orders@shop.example",
        staffRecipients: ["owner@shop.example"],
        disabledTemplates: [],
      },
      2,
      expect.any(String),
    );
    expect(refreshed()).toEqual(["/settings/notifications"]);
  });

  it("sends null as the version while the shop has never saved, and a blank sender as null", async () => {
    expect.hasAssertions();
    await actions.saveNotificationSettingsAction({
      expectedVersion: null,
      patch: { senderEmail: "  " },
    });

    expect(api.saveNotificationSettings).toHaveBeenCalledWith(
      expect.objectContaining({ senderEmail: null }),
      null,
      expect.any(String),
    );
  });

  it.each([
    ["no patch", { expectedVersion: 1 }],
    ["an empty patch", { expectedVersion: 1, patch: {} }],
    ["a field that is not part of the document", { expectedVersion: 1, patch: { version: 9 } }],
    ["a missing version", { patch: { senderEmail: null } }],
    ["a version of zero", { expectedVersion: 0, patch: { senderEmail: null } }],
    ["a sender that is not an address", { expectedVersion: 1, patch: { senderEmail: "nope" } }],
    [
      "a recipient that is not an address",
      { expectedVersion: 1, patch: { staffRecipients: ["x"] } },
    ],
    [
      "eleven recipients",
      {
        expectedVersion: 1,
        patch: { staffRecipients: Array.from({ length: 11 }, (_, i) => `a${i}@shop.example`) },
      },
    ],
    ["an unknown template switch", { expectedVersion: 1, patch: { disabledTemplates: ["x"] } }],
    ["a non-object", "hello"],
  ])("refuses %s before it reaches the API", async (_label, input) => {
    expect.hasAssertions();
    const result = await actions.saveNotificationSettingsAction(input);

    expect(result).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: {},
    });
    expect(api.saveNotificationSettings).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers a 409 with the page's conflict message and still refreshes the page", async () => {
    expect.hasAssertions();
    api.saveNotificationSettings.mockResolvedValue({ outcome: "conflict", message: "stale" });
    const result = await actions.saveNotificationSettingsAction({
      expectedVersion: 2,
      patch: { disabledTemplates: ["order_canceled"] },
    });

    expect(result).toEqual({ status: "error", message: copy.conflict, fieldErrors: {} });
    expect(refreshed()).toEqual(["/settings/notifications"]);
  });

  it("maps the server's field issues to messages in the page's language", async () => {
    expect.hasAssertions();
    api.saveNotificationSettings.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid notification settings",
      fields: [{ field: "senderEmail", message: "must be a valid email address" }],
    });
    const result = await actions.saveNotificationSettingsAction({
      expectedVersion: 2,
      patch: { senderEmail: "a@b.co" },
    });

    expect(result).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { senderEmail: copy.senderInvalid },
    });
    expect(refreshed()).toEqual(["/settings/notifications"]);
  });

  it("does not save when the fresh read fails, and says it was not allowed on a 401", async () => {
    expect.hasAssertions();
    api.fetchNotificationSettings.mockResolvedValue({ outcome: "unauthorized" });
    const result = await actions.saveNotificationSettingsAction({
      expectedVersion: 2,
      patch: { senderEmail: null },
    });

    expect(result).toMatchObject({ status: "error", message: en.formErrors.unauthorized });
    expect(api.saveNotificationSettings).not.toHaveBeenCalled();
    expect(refreshed()).toEqual(["/settings/notifications"]);
  });

  it("reports a server failure with the generic message and refreshes", async () => {
    expect.hasAssertions();
    api.saveNotificationSettings.mockResolvedValue({
      outcome: "error",
      message: "boom",
      status: 500,
    });
    const result = await actions.saveNotificationSettingsAction({
      expectedVersion: 2,
      patch: { senderEmail: null },
    });

    expect(result).toMatchObject({ status: "error", message: en.formErrors.unexpected });
    expect(refreshed()).toEqual(["/settings/notifications"]);
  });
});

describe("sender domain actions", () => {
  it("authenticate returns the domain and refreshes the page", async () => {
    expect.hasAssertions();
    api.startSenderDomain.mockResolvedValue({ outcome: "ok", data: { available: true } });
    const result = await actions.startSenderDomainAction();

    expect(result).toEqual({ status: "success", domain: { available: true } });
    expect(api.startSenderDomain).toHaveBeenCalledWith(expect.any(String));
    expect(refreshed()).toEqual(["/settings/notifications"]);
  });

  it("verify returns the domain and refreshes the page", async () => {
    expect.hasAssertions();
    api.verifySenderDomain.mockResolvedValue({ outcome: "ok", data: { available: true } });

    expect(await actions.verifySenderDomainAction()).toEqual({
      status: "success",
      domain: { available: true },
    });
    expect(refreshed()).toEqual(["/settings/notifications"]);
  });

  it("maps 503 NOT_CONFIGURED to unavailable and 502 to the provider message", async () => {
    expect.hasAssertions();
    api.startSenderDomain.mockResolvedValueOnce({ outcome: "error", message: "x", status: 503 });
    expect(await actions.startSenderDomainAction()).toEqual({ status: "unavailable" });

    api.verifySenderDomain.mockResolvedValueOnce({ outcome: "error", message: "x", status: 502 });
    expect(await actions.verifySenderDomainAction()).toEqual({
      status: "error",
      message: copy.domainProviderError,
    });
    expect(refreshed()).toEqual(["/settings/notifications", "/settings/notifications"]);
  });

  it("shows 'used by another store' in the page's language", async () => {
    expect.hasAssertions();
    api.startSenderDomain.mockResolvedValue({
      outcome: "conflict",
      message: "This domain is used by another store",
    });

    expect(await actions.startSenderDomainAction()).toEqual({
      status: "error",
      message: copy.domainUsedByAnotherStore,
    });
    expect(refreshed()).toEqual(["/settings/notifications"]);
  });

  it("localizes the free-mail refusal and passes other refusals through", async () => {
    expect.hasAssertions();
    api.startSenderDomain.mockResolvedValueOnce({
      outcome: "conflict",
      message: "Emails from gmail.com can't be authenticated. Replies will still reach you.",
    });
    expect(await actions.startSenderDomainAction()).toEqual({
      status: "error",
      message: copy.domainFreeMail.replace("{domain}", "gmail.com"),
    });

    api.startSenderDomain.mockResolvedValueOnce({
      outcome: "conflict",
      message:
        "Your store already sends from a.example. Only one domain per store is supported for now.",
    });
    expect(await actions.startSenderDomainAction()).toMatchObject({
      status: "error",
      message: expect.stringContaining("Only one domain per store"),
    });
  });
});
