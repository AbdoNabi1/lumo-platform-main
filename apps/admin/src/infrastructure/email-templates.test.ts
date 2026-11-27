import { beforeEach, describe, expect, it } from "vitest";
import { passwordResetEmail, staffInviteEmail } from "./email-templates";

const LINK = "https://admin.test/accept-invite?token=abc123&store=tenant-1";

beforeEach(() => {
  expect.hasAssertions();
});

describe("staffInviteEmail", () => {
  it("contains the link exactly once, both languages, the role in both, and the 7-day expiry", () => {
    const { subject, text } = staffInviteEmail(LINK, "Lumo", "Operator", "مشغّل");
    expect(text.split(LINK)).toHaveLength(2);
    expect(/[\u0600-\u06FF]/.test(text)).toBe(true);
    expect(/[A-Za-z]/.test(text)).toBe(true);
    expect(text).toContain("Operator");
    expect(text).toContain("مشغّل");
    expect(text).toContain("7 days");
    expect(text).toContain("٧ أيام");
    expect(/[\u0600-\u06FF]/.test(subject)).toBe(true);
    expect(subject).toContain("invited");
  });

  it("names the store when it is known", () => {
    const { text, subject } = staffInviteEmail(LINK, "Lumo", "Admin", "مدير");
    expect(text).toContain("Lumo");
    expect(subject).toContain("Lumo");
  });

  it("omits the store name cleanly when it is null (Wave 1d passes null)", () => {
    const { text, subject } = staffInviteEmail(LINK, null, "Viewer", "مشاهد");
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
    expect(subject).not.toContain("null");
    expect(text).toContain("Viewer");
    expect(text.split(LINK)).toHaveLength(2);
  });

  it("tells the person to ignore the email if they did not expect it, in both languages", () => {
    const { text } = staffInviteEmail(LINK, null, "Viewer", "مشاهد");
    expect(text).toContain("ignore");
    expect(text).toContain("تجاهل");
  });
});

describe("passwordResetEmail (unchanged)", () => {
  it("still carries the link in both languages", () => {
    expect(passwordResetEmail(LINK).text.split(LINK)).toHaveLength(3);
  });
});
