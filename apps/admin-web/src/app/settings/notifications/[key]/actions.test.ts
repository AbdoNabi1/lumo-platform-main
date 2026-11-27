import { beforeEach, describe, expect, it, vi } from "vitest";
import { detail, template } from "@/components/settings/notifications/test-fixtures";

const api = vi.hoisted(() => ({
  fetchNotificationSettings: vi.fn(),
  saveNotificationSettings: vi.fn(),
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

const editor = en.notificationSettings.editor;
const DRAFT = {
  key: "order_confirmation",
  locale: "en",
  subject: "Hi",
  body: "Thanks {{customer_name}}",
};

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  revalidatePath.mockReset();
});

function refreshed(): string[] {
  return revalidatePath.mock.calls.map((call) => String(call[0])).sort();
}

describe("saveTemplateAction", () => {
  it("saves the subject and message for that language and refreshes the list and the editor", async () => {
    expect.hasAssertions();
    const saved = detail(template(), "en");
    api.saveTemplateCopy.mockResolvedValue({ outcome: "ok", data: saved });

    const result = await actions.saveTemplateAction(DRAFT);

    expect(result).toEqual({ status: "success", template: saved });
    expect(api.saveTemplateCopy).toHaveBeenCalledWith(
      "order_confirmation",
      "en",
      expect.objectContaining({ subject: "Hi", body: "Thanks {{customer_name}}" }),
      expect.any(String),
    );
    expect(refreshed()).toEqual([
      "/settings/notifications",
      "/settings/notifications/order_confirmation",
    ]);
  });

  it("maps the server's field issues to messages in the page's language and still refreshes", async () => {
    expect.hasAssertions();
    api.saveTemplateCopy.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid template",
      fields: [
        { field: "subject", message: "at most 200 characters" },
        { field: "body", message: "at most 20000 characters" },
      ],
    });

    expect(await actions.saveTemplateAction(DRAFT)).toEqual({
      status: "error",
      message: en.formErrors.invalid,
      fieldErrors: { subject: editor.subjectInvalid, body: editor.bodyInvalid },
    });
    expect(refreshed()).toHaveLength(2);
  });

  it.each([
    ["an unknown template", { ...DRAFT, key: "nope" }],
    ["an unknown language", { ...DRAFT, locale: "fr" }],
    ["a subject that is not text", { ...DRAFT, subject: 4 }],
    ["no body", { key: "order_confirmation", locale: "en", subject: "x" }],
    ["a non-object", null],
  ])("refuses %s before it reaches the API", async (_label, input) => {
    expect.hasAssertions();
    expect(await actions.saveTemplateAction(input)).toMatchObject({ status: "error" });
    expect(api.saveTemplateCopy).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("revertTemplateAction", () => {
  it("deletes the merchant's copy for that language and refreshes the list and the editor", async () => {
    expect.hasAssertions();
    const reverted = detail(template(), "ar");
    api.revertTemplateCopy.mockResolvedValue({ outcome: "ok", data: reverted });

    expect(await actions.revertTemplateAction({ key: "order_confirmation", locale: "ar" })).toEqual(
      {
        status: "success",
        template: reverted,
      },
    );
    expect(api.revertTemplateCopy).toHaveBeenCalledWith("order_confirmation", "ar");
    expect(refreshed()).toEqual([
      "/settings/notifications",
      "/settings/notifications/order_confirmation",
    ]);
  });

  it("refreshes even when the API refuses, and refuses an unknown template without calling it", async () => {
    expect.hasAssertions();
    api.revertTemplateCopy.mockResolvedValue({ outcome: "forbidden" });
    expect(await actions.revertTemplateAction({ key: "order_confirmation", locale: "en" })).toEqual(
      {
        status: "error",
        message: en.formErrors.forbidden,
        fieldErrors: {},
      },
    );
    expect(refreshed()).toHaveLength(2);

    api.revertTemplateCopy.mockClear();
    expect(await actions.revertTemplateAction({ key: "x", locale: "en" })).toMatchObject({
      status: "error",
    });
    expect(api.revertTemplateCopy).not.toHaveBeenCalled();
  });
});

describe("previewTemplateAction", () => {
  it("returns the server's rendering and stores nothing, so nothing is refreshed", async () => {
    expect.hasAssertions();
    const preview = { subject: "Hi", html: "<p>Hi</p>", unknownVariables: ["nope"] };
    api.previewTemplateCopy.mockResolvedValue({ outcome: "ok", data: preview });

    expect(await actions.previewTemplateAction(DRAFT)).toEqual({ status: "success", preview });
    expect(api.previewTemplateCopy).toHaveBeenCalledWith("order_confirmation", DRAFT);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("explains a refused draft", async () => {
    expect.hasAssertions();
    api.previewTemplateCopy.mockResolvedValue({
      outcome: "invalid",
      message: "x",
      fields: [{ field: "subject", message: "at most 200 characters" }],
    });

    expect(await actions.previewTemplateAction(DRAFT)).toMatchObject({
      status: "error",
      fieldErrors: { subject: editor.subjectInvalid },
    });
  });
});

describe("sendTestEmailAction", () => {
  it("sends the draft with no recipient of its own: the server picks the signed-in member", async () => {
    expect.hasAssertions();
    api.sendTemplateTest.mockResolvedValue({ outcome: "ok", data: { sent: true } });

    expect(await actions.sendTestEmailAction({ ...DRAFT, to: "victim@elsewhere.example" })).toEqual(
      {
        status: "sent",
      },
    );
    expect(api.sendTemplateTest).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(api.sendTemplateTest.mock.calls[0])).not.toContain("victim@");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("maps 503 to unavailable and 429 to rate limited", async () => {
    expect.hasAssertions();
    api.sendTemplateTest.mockResolvedValueOnce({ outcome: "error", message: "x", status: 503 });
    expect(await actions.sendTestEmailAction(DRAFT)).toEqual({ status: "unavailable" });

    api.sendTemplateTest.mockResolvedValueOnce({ outcome: "error", message: "x", status: 429 });
    expect(await actions.sendTestEmailAction(DRAFT)).toEqual({ status: "rate_limited" });

    api.sendTemplateTest.mockResolvedValueOnce({ outcome: "error", message: "x", status: 500 });
    expect(await actions.sendTestEmailAction(DRAFT)).toEqual({
      status: "error",
      message: en.formErrors.unexpected,
    });
  });
});
