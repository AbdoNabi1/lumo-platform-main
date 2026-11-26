import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_CONNECTED,
  EMAIL_FAILED,
  EMAIL_NONE,
  SETTINGS,
} from "@/components/settings/notifications/test-fixtures";

const api = vi.hoisted(() => ({
  fetchNotificationSettings: vi.fn(),
  saveNotificationSettings: vi.fn(),
  saveEmailConnection: vi.fn(),
  setEmailConnectionEnabled: vi.fn(),
  testEmailConnection: vi.fn(),
  deleteEmailConnection: vi.fn(),
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

  it("sends null as the version while the shop has never saved, and the sender email back as it was read", async () => {
    expect.hasAssertions();
    await actions.saveNotificationSettingsAction({
      expectedVersion: null,
      patch: { disabledTemplates: ["order_canceled"] },
    });

    expect(api.saveNotificationSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        senderEmail: "orders@shop.example",
        disabledTemplates: ["order_canceled"],
      }),
      null,
      expect.any(String),
    );
  });

  it.each([
    ["no patch", { expectedVersion: 1 }],
    ["an empty patch", { expectedVersion: 1, patch: {} }],
    ["a field that is not part of the document", { expectedVersion: 1, patch: { version: 9 } }],
    ["a missing version", { patch: { disabledTemplates: [] } }],
    ["a version of zero", { expectedVersion: 0, patch: { disabledTemplates: [] } }],
    [
      "the sender email (it belongs to the email account now)",
      { expectedVersion: 1, patch: { senderEmail: "a@b.co" } },
    ],
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
      fields: [{ field: "staffRecipients", message: "must be a valid email address" }],
    });
    const result = await actions.saveNotificationSettingsAction({
      expectedVersion: 2,
      patch: { staffRecipients: ["a@b.co"] },
    });

    expect(result).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { staffRecipients: copy.recipientInvalid },
    });
    expect(refreshed()).toEqual(["/settings/notifications"]);
  });

  it("does not save when the fresh read fails, and says it was not allowed on a 401", async () => {
    expect.hasAssertions();
    api.fetchNotificationSettings.mockResolvedValue({ outcome: "unauthorized" });
    const result = await actions.saveNotificationSettingsAction({
      expectedVersion: 2,
      patch: { disabledTemplates: [] },
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
      patch: { disabledTemplates: [] },
    });

    expect(result).toMatchObject({ status: "error", message: en.formErrors.unexpected });
    expect(refreshed()).toEqual(["/settings/notifications"]);
  });
});

const BOTH_PAGES = ["/settings/customer-accounts", "/settings/notifications"];
const KEY = "re_abcdefghijklmnop1234";

describe("email account actions", () => {
  const save = {
    kind: "resend",
    fromEmail: " Orders@Shop.Example ",
    apiKey: ` ${KEY} `,
    expectedVersion: 2,
  };

  it("connects with the typed key, the normalized From and the version the page LOADED", async () => {
    expect.hasAssertions();
    api.saveEmailConnection.mockResolvedValue({ outcome: "ok", data: EMAIL_CONNECTED });
    const result = await actions.saveEmailConnectionAction(save);

    expect(result).toEqual({ status: "success", snapshot: EMAIL_CONNECTED });
    expect(api.saveEmailConnection).toHaveBeenCalledWith(
      { kind: "resend", fromEmail: "orders@shop.example", apiKey: KEY },
      2,
      expect.any(String),
    );
    expect(refreshed()).toEqual(BOTH_PAGES);
  });

  it("keeps the stored key when the key box is empty and sends null as the first version", async () => {
    expect.hasAssertions();
    api.saveEmailConnection.mockResolvedValue({ outcome: "ok", data: EMAIL_CONNECTED });
    await actions.saveEmailConnectionAction({ ...save, apiKey: "   ", expectedVersion: null });
    await actions.saveEmailConnectionAction({
      kind: "resend",
      fromEmail: "a@shop.example",
      expectedVersion: 4,
    });

    expect(api.saveEmailConnection).toHaveBeenNthCalledWith(
      1,
      { kind: "resend", fromEmail: "orders@shop.example", apiKey: null },
      null,
      expect.any(String),
    );
    expect(api.saveEmailConnection).toHaveBeenNthCalledWith(
      2,
      { kind: "resend", fromEmail: "a@shop.example", apiKey: null },
      4,
      expect.any(String),
    );
  });

  it("answers a refused test mail as a success whose connection is failed (shown honestly)", async () => {
    expect.hasAssertions();
    api.saveEmailConnection.mockResolvedValue({ outcome: "ok", data: EMAIL_FAILED });
    const result = await actions.saveEmailConnectionAction(save);

    expect(result).toEqual({ status: "success", snapshot: EMAIL_FAILED });
  });

  it.each([
    ["a non-object", "hello"],
    ["an unknown provider", { ...save, kind: "sendgrid" }],
    ["a From that is not an address", { ...save, fromEmail: "nope" }],
    ["a key that is not a string", { ...save, apiKey: 12 }],
    ["an enormous key", { ...save, apiKey: "x".repeat(300) }],
    ["a missing version", { kind: "resend", fromEmail: "a@shop.example" }],
    ["a version of zero", { ...save, expectedVersion: 0 }],
    ["a field that is not part of the call", { ...save, enabled: true }],
  ])("refuses %s before it reaches the API (and never echoes the key)", async (_label, input) => {
    expect.hasAssertions();
    const result = await actions.saveEmailConnectionAction(input);

    expect(result).toEqual({ status: "error", message: en.formErrors.invalid, fieldErrors: {} });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(api.saveEmailConnection).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers a 409 with the conflict message and still refreshes both pages", async () => {
    expect.hasAssertions();
    api.saveEmailConnection.mockResolvedValue({ outcome: "conflict", message: "stale" });

    expect(await actions.saveEmailConnectionAction(save)).toEqual({
      status: "conflict",
      message: copy.conflict,
    });
    expect(refreshed()).toEqual(BOTH_PAGES);
  });

  it("maps the server's field issues to messages in the page's language, never the key", async () => {
    expect.hasAssertions();
    api.saveEmailConnection.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid email connection",
      fields: [
        { field: "fromEmail", message: "bad" },
        { field: "apiKey", message: `bad ${KEY}` },
      ],
    });
    const result = await actions.saveEmailConnectionAction(save);

    expect(result).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { fromEmail: copy.email.fromInvalid, apiKey: copy.email.keyInvalid },
    });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(refreshed()).toEqual(BOTH_PAGES);
  });

  it("explains a signed-in member with no email address", async () => {
    expect.hasAssertions();
    api.saveEmailConnection.mockResolvedValue({
      outcome: "invalid",
      message: "x",
      fields: [{ field: "actor", message: "no email address" }],
    });

    expect(await actions.saveEmailConnectionAction(save)).toMatchObject({
      status: "error",
      message: copy.email.noAddress,
      fieldErrors: { actor: copy.email.noAddress },
    });
  });

  it.each([
    [
      "503 (the server cannot store keys)",
      { outcome: "error", message: "x", status: 503 },
      { status: "unavailable" },
    ],
    [
      "429 (too many test mails)",
      { outcome: "error", message: "x", status: 429 },
      { status: "rate_limited" },
    ],
    [
      "a server failure",
      { outcome: "error", message: "boom", status: 500 },
      { status: "error", message: en.formErrors.unexpected, fieldErrors: {} },
    ],
    [
      "a signed-out session",
      { outcome: "unauthorized" },
      { status: "error", message: en.formErrors.unauthorized, fieldErrors: {} },
    ],
  ])("maps %s and refreshes both pages", async (_label, apiResult, expected) => {
    expect.hasAssertions();
    api.saveEmailConnection.mockResolvedValue(apiResult);

    expect(await actions.saveEmailConnectionAction(save)).toEqual(expected);
    expect(refreshed()).toEqual(BOTH_PAGES);
  });

  it("switches the account on or off with the loaded version, and refuses a malformed call", async () => {
    expect.hasAssertions();
    api.setEmailConnectionEnabled.mockResolvedValue({ outcome: "ok", data: EMAIL_CONNECTED });

    expect(
      await actions.setEmailConnectionEnabledAction({ enabled: false, expectedVersion: 2 }),
    ).toEqual({ status: "success", snapshot: EMAIL_CONNECTED });
    expect(api.setEmailConnectionEnabled).toHaveBeenCalledWith(false, 2, expect.any(String));
    expect(refreshed()).toEqual(BOTH_PAGES);

    revalidatePath.mockReset();
    for (const input of [
      null,
      {},
      { enabled: "yes", expectedVersion: 2 },
      { enabled: true },
      { enabled: true, expectedVersion: null },
    ]) {
      expect(await actions.setEmailConnectionEnabledAction(input)).toEqual({
        status: "error",
        message: en.formErrors.invalid,
        fieldErrors: {},
      });
    }
    expect(api.setEmailConnectionEnabled).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("turns a stale switch into the conflict message and refreshes both pages", async () => {
    expect.hasAssertions();
    api.setEmailConnectionEnabled.mockResolvedValue({ outcome: "conflict", message: "stale" });

    expect(
      await actions.setEmailConnectionEnabledAction({ enabled: true, expectedVersion: 1 }),
    ).toEqual({
      status: "conflict",
      message: copy.conflict,
    });
    expect(refreshed()).toEqual(BOTH_PAGES);
  });

  it("sends a test and refreshes both pages (a refused test is a success with status failed)", async () => {
    expect.hasAssertions();
    api.testEmailConnection.mockResolvedValue({ outcome: "ok", data: EMAIL_FAILED });

    expect(await actions.testEmailConnectionAction()).toEqual({
      status: "success",
      snapshot: EMAIL_FAILED,
    });
    expect(api.testEmailConnection).toHaveBeenCalledWith(expect.any(String));
    expect(refreshed()).toEqual(BOTH_PAGES);
  });

  it("maps a test with no account (404), a rate limit and a missing key store", async () => {
    expect.hasAssertions();
    api.testEmailConnection.mockResolvedValueOnce({ outcome: "not_found" });
    expect(await actions.testEmailConnectionAction()).toEqual({
      status: "error",
      message: en.formErrors.notFound,
      fieldErrors: {},
    });
    api.testEmailConnection.mockResolvedValueOnce({ outcome: "error", message: "x", status: 429 });
    expect(await actions.testEmailConnectionAction()).toEqual({ status: "rate_limited" });
    api.testEmailConnection.mockResolvedValueOnce({ outcome: "error", message: "x", status: 503 });
    expect(await actions.testEmailConnectionAction()).toEqual({ status: "unavailable" });
    expect(revalidatePath).toHaveBeenCalledTimes(6);
  });

  it("disconnects and refreshes both pages, also when the API refuses", async () => {
    expect.hasAssertions();
    api.deleteEmailConnection.mockResolvedValueOnce({ outcome: "ok", data: EMAIL_NONE });
    expect(await actions.disconnectEmailConnectionAction()).toEqual({
      status: "success",
      snapshot: EMAIL_NONE,
    });
    expect(refreshed()).toEqual(BOTH_PAGES);

    revalidatePath.mockReset();
    api.deleteEmailConnection.mockResolvedValueOnce({ outcome: "forbidden" });
    expect(await actions.disconnectEmailConnectionAction()).toEqual({
      status: "error",
      message: en.formErrors.forbidden,
      fieldErrors: {},
    });
    expect(refreshed()).toEqual(BOTH_PAGES);
  });
});

describe("the sender-domain actions are gone", () => {
  it("exports no sender-domain action", () => {
    expect.hasAssertions();
    expect(Object.keys(actions).filter((name) => /domain/i.test(name))).toEqual([]);
  });
});
