import { describe, expect, it } from "vitest";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { countForm, dayCountPhrase } from "./day-count";

describe("countForm", () => {
  it.each([
    [1, "one"],
    [2, "two"],
    [3, "few"],
    [10, "few"],
    [11, "many"],
    [14, "many"],
    [30, "many"],
  ] as const)("reads %i as %s", (count, form) => {
    expect(countForm(count)).toBe(form);
  });
});

describe("dayCountPhrase", () => {
  it("agrees the Arabic noun with the number", () => {
    expect(dayCountPhrase(ar.dayCount, 1, "1")).toBe("يوم واحد");
    expect(dayCountPhrase(ar.dayCount, 2, "2")).toBe("يومين");
    expect(dayCountPhrase(ar.dayCount, 3, "٣")).toBe("٣ أيام");
    expect(dayCountPhrase(ar.dayCount, 11, "١١")).toBe("١١ يوم");
  });

  it("keeps English singular and plural", () => {
    expect(dayCountPhrase(en.dayCount, 1, "1")).toBe("1 day");
    expect(dayCountPhrase(en.dayCount, 2, "2")).toBe("2 days");
    expect(dayCountPhrase(en.dayCount, 3, "3")).toBe("3 days");
    expect(dayCountPhrase(en.dayCount, 11, "11")).toBe("11 days");
  });
});
