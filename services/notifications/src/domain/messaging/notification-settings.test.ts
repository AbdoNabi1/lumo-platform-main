import { describe, expect, it } from "vitest";
import {
  MAX_BODY_LENGTH,
  MAX_STAFF_RECIPIENTS,
  validateNotificationSettings,
  validateTemplateCopy,
  validateTemplateRef,
} from "./notification-settings";

const valid = { senderEmail: null, staffRecipients: [], disabledTemplates: [] };

function issues(result: ReturnType<typeof validateNotificationSettings>): string[] {
  return result.ok ? [] : result.error.fields.map((i) => i.field);
}

describe("validateNotificationSettings", () => {
  it("accepts the defaults and normalises addresses", () => {
    expect.hasAssertions();
    const result = validateNotificationSettings({
      senderEmail: "  Shop@Nusuj.com ",
      staffRecipients: ["A@x.com", "a@x.com", "b@x.com"],
      disabledTemplates: ["order_canceled", "order_confirmation", "order_canceled"],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        senderEmail: "shop@nusuj.com",
        staffRecipients: ["a@x.com", "b@x.com"],
        disabledTemplates: ["order_confirmation", "order_canceled"],
      },
    });
    expect(validateNotificationSettings(valid).ok).toBe(true);
    expect(validateNotificationSettings({ ...valid, senderEmail: "  " })).toMatchObject({
      ok: true,
      value: { senderEmail: null },
    });
  });

  it("refuses a bad sender email", () => {
    expect.hasAssertions();
    expect(issues(validateNotificationSettings({ ...valid, senderEmail: "nope" }))).toEqual([
      "senderEmail",
    ]);
    expect(issues(validateNotificationSettings({ ...valid, senderEmail: 5 }))).toEqual([
      "senderEmail",
    ]);
  });

  it(`allows ${MAX_STAFF_RECIPIENTS} recipients and refuses an eleventh or an invalid one`, () => {
    expect.hasAssertions();
    const ten = Array.from({ length: 10 }, (_, i) => `s${i}@x.com`);
    expect(validateNotificationSettings({ ...valid, staffRecipients: ten }).ok).toBe(true);
    expect(
      issues(validateNotificationSettings({ ...valid, staffRecipients: [...ten, "s10@x.com"] })),
    ).toEqual(["staffRecipients"]);
    expect(issues(validateNotificationSettings({ ...valid, staffRecipients: ["bad"] }))).toEqual([
      "staffRecipients",
    ]);
  });

  it("refuses an unknown template key and non-object input", () => {
    expect.hasAssertions();
    expect(issues(validateNotificationSettings({ ...valid, disabledTemplates: ["nope"] }))).toEqual(
      ["disabledTemplates"],
    );
    expect(validateNotificationSettings(null).ok).toBe(false);
  });
});

describe("validateTemplateCopy / validateTemplateRef", () => {
  it("bounds subject and body and keeps the subject on one line", () => {
    expect.hasAssertions();
    expect(validateTemplateCopy({ subject: " Hi ", body: "x" })).toEqual({
      ok: true,
      value: { subject: "Hi", body: "x" },
    });
    expect(validateTemplateCopy({ subject: "x".repeat(201), body: "x" }).ok).toBe(false);
    expect(validateTemplateCopy({ subject: "x".repeat(200), body: "x" }).ok).toBe(true);
    expect(validateTemplateCopy({ subject: "a\nb", body: "x" }).ok).toBe(false);
    expect(validateTemplateCopy({ subject: "a", body: "x".repeat(MAX_BODY_LENGTH + 1) }).ok).toBe(
      false,
    );
    expect(validateTemplateCopy({ subject: "a", body: "x".repeat(MAX_BODY_LENGTH) }).ok).toBe(true);
    expect(validateTemplateCopy({ subject: "", body: " " }).ok).toBe(false);
  });

  it("knows the keys and locales", () => {
    expect.hasAssertions();
    expect(validateTemplateRef("order_confirmation", "ar").ok).toBe(true);
    expect(validateTemplateRef("order_confirmation", undefined)).toMatchObject({
      ok: true,
      value: { locale: "en" },
    });
    expect(validateTemplateRef("nope", "en").ok).toBe(false);
    expect(validateTemplateRef("order_confirmation", "fr").ok).toBe(false);
  });
});
