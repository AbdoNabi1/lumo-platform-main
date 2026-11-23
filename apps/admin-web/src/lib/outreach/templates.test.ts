import { describe, expect, it } from "vitest";
import type { WhatsAppTemplateRowDto } from "@/lib/api/outreach";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import {
  categoryLabel,
  languageLabel,
  reasonText,
  templateIssueMessage,
  templateStatusBadge,
  toTemplateDraftBody,
  visibleTemplates,
} from "./templates";

const row = (status: string): WhatsAppTemplateRowDto => ({
  name: `t_${status.toLowerCase()}`,
  language: "en",
  category: "UTILITY",
  status,
  rejectedReason: null,
  variableCount: 0,
  supported: true,
  sendShape: { bodyVariableCount: 0, headerHasVariable: false, buttons: [] },
});

describe("visibleTemplates", () => {
  it("drops deleted and archived rows only", () => {
    expect.hasAssertions();
    const shown = visibleTemplates(
      ["APPROVED", "DELETED", "ARCHIVED", "PENDING_DELETION", "UNKNOWN", "REJECTED"].map(row),
    );
    expect(shown.map((r) => r.status)).toEqual([
      "APPROVED",
      "PENDING_DELETION",
      "UNKNOWN",
      "REJECTED",
    ]);
  });
});

describe("labels", () => {
  it("map known values and collapse unknown ones to generic copy in both languages", () => {
    expect.hasAssertions();
    for (const t of [en, ar]) {
      expect(languageLabel("ar", t)).toBe(t.whatsappTemplates.languages.ar);
      expect(languageLabel("klingon", t)).toBe(t.whatsappTemplates.languages.other);
      expect(languageLabel("other", t)).toBe(t.whatsappTemplates.languages.other);
      expect(categoryLabel("MARKETING", t)).toBe(t.whatsappTemplates.categories.MARKETING);
      expect(categoryLabel("AUTHENTICATION", t)).toBe(t.whatsappTemplates.categories.other);
      expect(reasonText("SCAM", t)).toBe(t.whatsappTemplates.reasons.SCAM);
      expect(reasonText("anything", t)).toBe(t.whatsappTemplates.reasons.other);
      expect(reasonText(null, t)).toBe(t.whatsappTemplates.reasons.other);
      expect(templateIssueMessage("name_format", t)).toBe(t.whatsappTemplates.issues.name_format);
      expect(templateIssueMessage("Provider says no", t)).toBe(t.whatsappTemplates.issues.unknown);
      expect(templateIssueMessage(undefined, t)).toBe(t.whatsappTemplates.issues.unknown);
      expect(templateIssueMessage("toString", t)).toBe(t.whatsappTemplates.issues.unknown);
    }
  });

  it("colours the badges: Approved green, Pending amber, Rejected red, the rest neutral", () => {
    expect.hasAssertions();
    expect(templateStatusBadge("APPROVED", en).variant).toBe("success");
    expect(templateStatusBadge("PENDING", en).variant).toBe("warning");
    expect(templateStatusBadge("IN_APPEAL", en).variant).toBe("warning");
    expect(templateStatusBadge("REJECTED", en).variant).toBe("destructive");
    expect(templateStatusBadge("PAUSED", en).variant).toBe("neutral");
    expect(templateStatusBadge("DISABLED", en).variant).toBe("neutral");
    expect(templateStatusBadge("SOMETHING", en)).toEqual({
      label: en.whatsappTemplates.statuses.other,
      variant: "neutral",
    });
  });
});

describe("toTemplateDraftBody", () => {
  const valid = {
    name: "order_update",
    language: "en",
    category: "UTILITY",
    body: { text: "Hi", examples: [] },
  };

  it("keeps only the known keys and omits absent parts", () => {
    expect.hasAssertions();
    expect(toTemplateDraftBody({ ...valid, extra: 1 })).toEqual(valid);
    expect(
      toTemplateDraftBody({
        ...valid,
        header: { format: "TEXT", text: "H {{1}}", example: "x", junk: 1 },
        footer: { text: "F", junk: 1 },
        buttons: [
          { type: "QUICK_REPLY", text: "Ok", junk: 1 },
          {
            type: "URL",
            text: "Go",
            url: "https://a.example/{{1}}",
            example: "https://a.example/1",
          },
        ],
      }),
    ).toEqual({
      ...valid,
      header: { format: "TEXT", text: "H {{1}}", example: "x" },
      footer: { text: "F" },
      buttons: [
        { type: "QUICK_REPLY", text: "Ok" },
        { type: "URL", text: "Go", url: "https://a.example/{{1}}", example: "https://a.example/1" },
      ],
    });
  });

  it.each([
    ["not an object", null],
    ["a string", "x"],
    ["AUTHENTICATION", { ...valid, category: "AUTHENTICATION" }],
    ["a numeric name", { ...valid, name: 3 }],
    ["an empty name", { ...valid, name: "" }],
    ["an oversized name", { ...valid, name: "a".repeat(513) }],
    ["a missing body", { ...valid, body: undefined }],
    ["non-string examples", { ...valid, body: { text: "x", examples: [1] } }],
    ["a media header", { ...valid, header: { format: "IMAGE", text: "x" } }],
    ["a phone button", { ...valid, buttons: [{ type: "PHONE_NUMBER", text: "Call" }] }],
    [
      "too many buttons",
      { ...valid, buttons: Array.from({ length: 21 }, () => ({ type: "QUICK_REPLY", text: "x" })) },
    ],
    ["an oversized body", { ...valid, body: { text: "a".repeat(2001), examples: [] } }],
  ])("rejects %s", (_name, input) => {
    expect.hasAssertions();
    expect(toTemplateDraftBody(input)).toBeNull();
  });
});
