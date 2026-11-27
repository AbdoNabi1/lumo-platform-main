import { beforeEach, describe, expect, it } from "vitest";
import { toBostaPhone } from "./phone";

beforeEach(() => {
  expect.hasAssertions();
});

describe("Egyptian mobile phones", () => {
  it.each([
    ["01065685435", "01065685435"],
    ["+201065685435", "01065685435"],
    ["00201065685435", "01065685435"],
    ["201065685435", "01065685435"],
    ["1065685435", "01065685435"],
    ["٠١٠٦٥٦٨٥٤٣٥", "01065685435"],
    ["۰۱۰۶۵۶۸۵۴۳۵", "01065685435"],
    ["010 6568-5435", "01065685435"],
    ["01565685435", "01565685435"],
  ])("normalizes %s", (raw, expected) => {
    expect(toBostaPhone(raw)).toBe(expected);
  });
  it.each(["", "0226385555", "01365685435", "+966123456789", "0106568543", "phone", undefined])(
    "refuses %j",
    (raw) => {
      expect(toBostaPhone(raw)).toBeNull();
    },
  );
});
