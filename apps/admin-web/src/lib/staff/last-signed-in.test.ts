import { describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { formatLastSignedIn } from "./last-signed-in";

const NOW = "2026-11-24T12:00:00.000Z";

describe("formatLastSignedIn", () => {
  it("says Never when the person has not signed in", () => {
    expect.hasAssertions();
    expect(formatLastSignedIn(null, NOW, "en", en)).toBe("Never");
    expect(formatLastSignedIn(null, NOW, "ar", ar)).toBe(ar.users.never);
  });

  it("is relative inside the last month and a plain date after it", () => {
    expect.hasAssertions();
    expect(formatLastSignedIn("2026-11-24T11:59:40.000Z", NOW, "en", en)).toBe("Just now");
    expect(formatLastSignedIn("2026-11-24T11:30:00.000Z", NOW, "en", en)).toBe("30 minutes ago");
    expect(formatLastSignedIn("2026-11-24T09:00:00.000Z", NOW, "en", en)).toBe("3 hours ago");
    expect(formatLastSignedIn("2026-11-21T12:00:00.000Z", NOW, "en", en)).toBe("3 days ago");
    expect(formatLastSignedIn("2026-11-23T12:00:00.000Z", NOW, "en", en)).toBe("yesterday");
    const old = formatLastSignedIn("2026-09-01T12:00:00.000Z", NOW, "en", en);
    expect(old).toMatch(/2026/);
    expect(old).not.toMatch(/ago/);
  });

  it("renders Arabic phrases from Intl, not English", () => {
    expect.hasAssertions();
    const text = formatLastSignedIn("2026-11-21T12:00:00.000Z", NOW, "ar", ar);
    expect(text).not.toMatch(/ago/);
    expect(text.length).toBeGreaterThan(0);
  });

  it("never shows a future time as negative: clamps to Just now", () => {
    expect.hasAssertions();
    expect(formatLastSignedIn("2026-11-24T12:00:30.000Z", NOW, "en", en)).toBe("Just now");
  });
});
