import { beforeEach, describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { formatFileDate, formatFileSize, formatFileType, isImageFile } from "./format";

beforeEach(() => {
  expect.hasAssertions();
});

describe("formatFileSize", () => {
  it.each([
    [0, "0 B"],
    [812, "812 B"],
    [1023, "1,023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024 - 1, "1,024.0 KB"],
    [1024 * 1024, "1.0 MB"],
    [2.5 * 1024 * 1024, "2.5 MB"],
  ])("formats %d bytes as %s in English", (bytes, expected) => {
    expect(formatFileSize(bytes, "en", en)).toBe(expected);
  });

  it("shows the dash for a missing or invalid size", () => {
    expect(formatFileSize(null, "en", en)).toBe("—");
    expect(formatFileSize(-1, "en", en)).toBe("—");
    expect(formatFileSize(Number.NaN, "en", en)).toBe("—");
  });

  it("uses the Arabic units and locale digits", () => {
    const text = formatFileSize(1536, "ar", ar);
    expect(text).toContain(ar.files.units.kb);
    expect(text).not.toContain("KB");
    expect(text).toBe(
      `${new Intl.NumberFormat("ar", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(1.5)} ${ar.files.units.kb}`,
    );
  });
});

describe("formatFileType", () => {
  it("shows the upper-cased subtype", () => {
    expect(formatFileType("image/png", en)).toBe("PNG");
    expect(formatFileType("image/webp", en)).toBe("WEBP");
    expect(formatFileType("image/svg+xml", en)).toBe("SVG");
  });

  it("shows the dash for null or a malformed type", () => {
    expect(formatFileType(null, en)).toBe("—");
    expect(formatFileType("image", en)).toBe("—");
    expect(formatFileType("image/", en)).toBe("—");
  });
});

describe("formatFileDate", () => {
  it("formats in UTC, so the day does not depend on the machine", () => {
    expect(formatFileDate("2026-11-24T23:30:00.000Z", "en", en)).toBe("Nov 24, 2026");
  });

  it("formats in the Arabic locale", () => {
    const text = formatFileDate("2026-11-24T10:00:00.000Z", "ar", ar);
    expect(text).not.toBe("Nov 24, 2026");
    expect(text.length).toBeGreaterThan(0);
  });

  it("shows the dash for null or an invalid date", () => {
    expect(formatFileDate(null, "en", en)).toBe("—");
    expect(formatFileDate("not a date", "en", en)).toBe("—");
  });
});

describe("isImageFile", () => {
  it("is true only for a row with a picture url", () => {
    expect(isImageFile({ image: { url: "https://cdn.test/a.webp" } })).toBe(true);
    expect(isImageFile({ image: { url: "" } })).toBe(false);
    expect(isImageFile({ image: null })).toBe(false);
  });
});
