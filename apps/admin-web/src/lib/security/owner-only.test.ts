import { describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { ownerOnlyOr } from "./owner-only";

describe("ownerOnlyOr", () => {
  it("says only the store owner can open the page on a 403, in both languages", () => {
    expect.hasAssertions();
    expect(ownerOnlyOr({ status: 403 }, en, "Sign in")).toBe(
      "Only the store owner can open this page.",
    );
    expect(ownerOnlyOr({ status: 403 }, ar, "سجّل الدخول")).toBe(
      "يمكن لمالك المتجر فقط فتح هذه الصفحة.",
    );
  });

  it("keeps the screen's own message for a 401 (no status) or any other status", () => {
    expect.hasAssertions();
    expect(ownerOnlyOr({}, en, "Sign in")).toBe("Sign in");
    expect(ownerOnlyOr({ status: 401 }, en, "Sign in")).toBe("Sign in");
  });
});
