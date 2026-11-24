import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ getAdminApi: vi.fn(), mutateAdminApi: vi.fn() }));
vi.mock("./client", () => client);
import {
  createWhatsAppTemplate,
  deleteWhatsAppTemplate,
  fetchEmailSettings,
  fetchWhatsAppTemplateRows,
  isDeletedResult,
  isEmailSettingsDto,
  isWhatsAppTemplateRowDto,
  isWhatsAppTemplateRowList,
  sendTestEmail,
  syncWhatsAppTemplates,
  type TemplateDraftBody,
} from "./outreach";

/** A template exactly as `templateDto` produces it, with a rejection reason. */
const rejected = {
  name: "summer_sale",
  language: "ar",
  category: "MARKETING",
  status: "REJECTED",
  rejectedReason: "INCORRECT_CATEGORY",
  components: [{ type: "BODY", text: "x {{1}} y", example: { body_text: [["a"]] } }],
  variableCount: 1,
  buttons: [],
  supported: true,
  sendShape: { bodyVariableCount: 1, headerHasVariable: false, buttons: [] },
};

const draft: TemplateDraftBody = {
  name: "order_update",
  language: "en",
  category: "UTILITY",
  body: { text: "Hi {{1}}, your order is on its way.", examples: ["Sara"] },
};

beforeEach(() => {
  expect.hasAssertions();
  vi.clearAllMocks();
});

describe("template row guard", () => {
  it("accepts the presenter shape with a rejection reason or null", () => {
    expect.hasAssertions();
    expect(isWhatsAppTemplateRowDto(rejected)).toBe(true);
    expect(isWhatsAppTemplateRowDto({ ...rejected, rejectedReason: null })).toBe(true);
    expect(isWhatsAppTemplateRowList([rejected, { ...rejected, status: "APPROVED" }])).toBe(true);
  });

  it("rejects a row without rejectedReason, a numeric reason, or a malformed shape", () => {
    expect.hasAssertions();
    const { rejectedReason: _omitted, ...without } = rejected;
    expect(isWhatsAppTemplateRowDto(without)).toBe(false);
    expect(isWhatsAppTemplateRowDto({ ...rejected, rejectedReason: 4 })).toBe(false);
    expect(isWhatsAppTemplateRowDto({ ...rejected, sendShape: null })).toBe(false);
    expect(isWhatsAppTemplateRowList([rejected, 1])).toBe(false);
  });

  it("guards the delete result", () => {
    expect.hasAssertions();
    expect(isDeletedResult({ deleted: 2 })).toBe(true);
    expect(isDeletedResult({ deleted: "2" })).toBe(false);
    expect(isDeletedResult(null)).toBe(false);
  });
});

describe("template reads and writes", () => {
  it("lists rows without the raw Meta components", async () => {
    expect.hasAssertions();
    client.getAdminApi.mockResolvedValue({ outcome: "ok", data: [rejected] });
    const result = await fetchWhatsAppTemplateRows();
    expect(client.getAdminApi).toHaveBeenCalledWith(
      "/api/v1/outreach/whatsapp/templates",
      expect.any(Function),
    );
    expect(result).toEqual({
      outcome: "ok",
      data: [
        {
          name: "summer_sale",
          language: "ar",
          category: "MARKETING",
          status: "REJECTED",
          rejectedReason: "INCORRECT_CATEGORY",
          variableCount: 1,
          supported: true,
          sendShape: { bodyVariableCount: 1, headerHasVariable: false, buttons: [] },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("components");
  });

  it("passes a failed read through untouched", async () => {
    expect.hasAssertions();
    client.getAdminApi.mockResolvedValue({ outcome: "unauthorized" });
    expect(await fetchWhatsAppTemplateRows()).toEqual({ outcome: "unauthorized" });
  });

  it("sync posts with a long timeout and the caller's key", async () => {
    expect.hasAssertions();
    client.mutateAdminApi.mockResolvedValue({ outcome: "ok", data: [] });
    await syncWhatsAppTemplates("key-sync-0001");
    expect(client.mutateAdminApi).toHaveBeenCalledWith(
      "/api/v1/outreach/whatsapp/templates/sync",
      { method: "POST", idempotencyKey: "key-sync-0001", timeoutMs: 60_000 },
      expect.any(Function),
    );
  });

  it("create posts the draft with the caller's key", async () => {
    expect.hasAssertions();
    client.mutateAdminApi.mockResolvedValue({ outcome: "ok", data: rejected });
    await createWhatsAppTemplate(draft, "key-create-01");
    expect(client.mutateAdminApi).toHaveBeenCalledWith(
      "/api/v1/outreach/whatsapp/templates",
      { method: "POST", body: draft, idempotencyKey: "key-create-01", timeoutMs: 60_000 },
      expect.any(Function),
    );
  });

  it("delete is a DELETE by the url-encoded name", async () => {
    expect.hasAssertions();
    client.mutateAdminApi.mockResolvedValue({ outcome: "ok", data: { deleted: 1 } });
    await deleteWhatsAppTemplate("order_update", "key-delete-1");
    expect(client.mutateAdminApi).toHaveBeenCalledWith(
      "/api/v1/outreach/whatsapp/templates/order_update",
      { method: "DELETE", idempotencyKey: "key-delete-1", timeoutMs: 60_000 },
      expect.any(Function),
    );
    await deleteWhatsAppTemplate("a/b c", "key-delete-2");
    expect(client.mutateAdminApi.mock.calls[1]?.[0]).toBe(
      "/api/v1/outreach/whatsapp/templates/a%2Fb%20c",
    );
  });
});

describe("email", () => {
  it("guards the settings DTO", () => {
    expect.hasAssertions();
    expect(
      isEmailSettingsDto({ available: true, from: "Nour <noreply@example.com>", replyTo: null }),
    ).toBe(true);
    expect(isEmailSettingsDto({ available: false, from: null, replyTo: null })).toBe(true);
    expect(isEmailSettingsDto({ available: "yes", from: null, replyTo: null })).toBe(false);
    expect(isEmailSettingsDto({ available: true, from: 3, replyTo: null })).toBe(false);
    expect(isEmailSettingsDto({ available: true, from: null })).toBe(false);
  });

  it("projects the settings and passes failures through", async () => {
    expect.hasAssertions();
    client.getAdminApi.mockResolvedValue({
      outcome: "ok",
      data: { available: true, from: "Nour <a@b.co>", replyTo: "hi@b.co", extra: "x" },
    });
    expect(await fetchEmailSettings()).toEqual({
      outcome: "ok",
      data: { available: true, from: "Nour <a@b.co>", replyTo: "hi@b.co" },
    });
    expect(client.getAdminApi).toHaveBeenCalledWith("/api/v1/outreach/email", expect.any(Function));
    client.getAdminApi.mockResolvedValue({ outcome: "error", message: "x" });
    expect(await fetchEmailSettings()).toEqual({ outcome: "error", message: "x" });
  });

  it("test-send posts the address with the caller's key", async () => {
    expect.hasAssertions();
    client.mutateAdminApi.mockResolvedValue({ outcome: "ok", data: {} });
    await sendTestEmail("owner@example.com", "key-email-001");
    expect(client.mutateAdminApi).toHaveBeenCalledWith(
      "/api/v1/outreach/email/test-send",
      {
        method: "POST",
        body: { to: "owner@example.com" },
        idempotencyKey: "key-email-001",
        timeoutMs: 45_000,
      },
      expect.any(Function),
    );
  });
});
