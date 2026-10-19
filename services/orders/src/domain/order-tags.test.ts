import { describe, expect, it } from "vitest";
import {
  characterCount,
  clampSuggestionLimit,
  MAX_NOTE_LENGTH,
  normalizeNote,
  normalizeTag,
  parseTags,
  sortTags,
  tagKeyOf,
} from "./order-tags";

describe("normalizeTag / tagKeyOf", () => {
  it("trims, collapses inner whitespace, and lower-cases only the key", () => {
    expect(normalizeTag("  VIP   Customer\t")).toBe("VIP Customer");
    expect(tagKeyOf("  VIP   Customer\t")).toBe("vip customer");
  });

  it("leaves Arabic as typed (it has no case)", () => {
    expect(tagKeyOf(" عميل   مميز ")).toBe("عميل مميز");
  });

  it("composes to NFC, so the same letters typed two ways are one tag", () => {
    expect(tagKeyOf("Cafe\u0301")).toBe(tagKeyOf("Caf\u00e9"));
  });
});

describe("parseTags", () => {
  it("splits on commas, drops blanks and keeps the first spelling of a case-insensitive duplicate", () => {
    expect(parseTags(["VIP, urgent", " vip ", ",", "Urgent"])).toEqual({
      ok: true,
      value: [
        { tag: "VIP", tagKey: "vip" },
        { tag: "urgent", tagKey: "urgent" },
      ],
    });
  });

  it("counts characters, not UTF-16 units: 40 emoji or Arabic letters fit, 41 letters do not", () => {
    expect(parseTags(["😀".repeat(40)]).ok).toBe(true);
    expect(parseTags(["ب".repeat(40)]).ok).toBe(true);
    const tooLong = parseTags(["ok", "x".repeat(41)]);
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error.code).toBe("VALIDATION");
  });

  it("answers an empty list for only blanks (the caller decides whether that is an error)", () => {
    expect(parseTags([" ", ",", ""])).toEqual({ ok: true, value: [] });
  });
});

describe("normalizeNote", () => {
  it("trims the ends and keeps inner line breaks", () => {
    expect(normalizeNote("  Leave at the door\nRing twice  ")).toEqual({
      ok: true,
      value: "Leave at the door\nRing twice",
    });
  });

  it("turns null, empty and whitespace-only into no note (Review Focus 2)", () => {
    for (const raw of [null, "", "   \n\t "]) {
      expect(normalizeNote(raw)).toEqual({ ok: true, value: null });
    }
  });

  it("allows 5,000 characters and refuses 5,001", () => {
    expect(normalizeNote("a".repeat(MAX_NOTE_LENGTH)).ok).toBe(true);
    const tooLong = normalizeNote("ب".repeat(MAX_NOTE_LENGTH + 1));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error.code).toBe("VALIDATION");
  });
});

describe("sortTags / characterCount / clampSuggestionLimit", () => {
  it("sorts by key (case-insensitive), then by spelling", () => {
    expect(sortTags(["vip", "Urgent", "apple", "VIP"])).toEqual(["apple", "Urgent", "VIP", "vip"]);
  });

  it("counts code points", () => {
    expect(characterCount("😀ب")).toBe(2);
  });

  it("keeps a suggestion limit between 1 and 50", () => {
    expect(clampSuggestionLimit(500)).toBe(50);
    expect(clampSuggestionLimit(0)).toBe(1);
    expect(clampSuggestionLimit(7.9)).toBe(7);
    expect(clampSuggestionLimit(Number.NaN)).toBe(50);
  });
});
