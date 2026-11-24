import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Money from "@/lib/products/money";

// The draft must delegate the string-to-minor conversion to the shared money helper (R1).
const spies = vi.hoisted(() => ({ toMinorUnits: vi.fn() }));
vi.mock("@/lib/products/money", async (importOriginal) => {
  const actual = await importOriginal<typeof Money>();
  spies.toMinorUnits.mockImplementation(actual.toMinorUnits);
  return { ...actual, toMinorUnits: spies.toMinorUnits };
});

const { conditionFromDraft, newDraft } = await import("./segment-draft");
const { toMinorUnits } = await import("@/lib/products/money");

function amount(text: string, currency: string) {
  return conditionFromDraft({ ...newDraft("r1", "amount_spent"), op: "eq", text }, currency);
}

beforeEach(() => {
  expect.hasAssertions();
  spies.toMinorUnits.mockClear();
});

describe("segment-draft money delegates to the shared toMinorUnits (R1)", () => {
  it.each([
    ["EGP", "0.29", 29],
    ["JPY", "29", 29],
    ["KWD", "0.029", 29],
    ["EGP", "١٢٫٣٤", 1234],
  ])("%s %s -> %i minor units, converted by the shared helper", (currency, text, minor) => {
    expect(amount(text, currency)).toMatchObject({
      ok: true,
      condition: { field: "amount_spent", valueMinor: minor },
    });
    expect(spies.toMinorUnits).toHaveBeenCalledTimes(1);
    expect(spies.toMinorUnits.mock.calls[0]?.[1]).toBe(currency);
    expect(toMinorUnits(text, currency)).toBe(minor);
  });

  it("JPY 1.5 is a distinct 'tooManyDecimals' error (checked before delegating)", () => {
    expect(amount("1.5", "JPY")).toEqual({
      ok: false,
      field: "valueMinor",
      error: "tooManyDecimals",
    });
  });

  it("blank is 'required' and letters are 'invalidAmount', without converting", () => {
    expect(amount("  ", "EGP")).toMatchObject({ ok: false, error: "required" });
    expect(amount("abc", "EGP")).toMatchObject({ ok: false, error: "invalidAmount" });
    expect(spies.toMinorUnits).not.toHaveBeenCalled();
  });

  it("a null from the helper (unsafe integer) is 'invalidAmount'", () => {
    expect(amount("99999999999999999999", "EGP")).toEqual({
      ok: false,
      field: "valueMinor",
      error: "invalidAmount",
    });
    expect(spies.toMinorUnits).toHaveBeenCalledTimes(1);
  });
});
