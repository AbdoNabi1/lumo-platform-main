import { beforeEach, describe, expect, it } from "vitest";
import type { SegmentCondition } from "@/lib/api/customer-segments";
import {
  conditionFromDraft,
  conditionsFromDrafts,
  draftFromCondition,
  newDraft,
  OPS_BY_FIELD,
  parseCountries,
  SEGMENT_FIELDS,
  valueKind,
  withField,
  withOp,
  type ConditionDraft,
} from "./segment-draft";

beforeEach(() => {
  expect.hasAssertions();
});

function draft(patch: Partial<ConditionDraft> & Pick<ConditionDraft, "field">): ConditionDraft {
  return { ...newDraft("r1", patch.field), ...patch };
}

describe("money (Plan review 1, finding 1: shop currency, never EGP by default)", () => {
  it.each([
    ["EGP", "0.29", 29],
    ["JPY", "29", 29],
    ["KWD", "0.029", 29],
    ["EGP", "١٢٫٣٤", 1234],
    ["EGP", "1,250.5", 125050],
    ["EGP", "150", 15000],
  ])("%s %s -> %i minor units", (currency, text, minor) => {
    expect(conditionFromDraft(draft({ field: "amount_spent", op: "gte", text }), currency)).toEqual(
      {
        ok: true,
        condition: { field: "amount_spent", op: "gte", valueMinor: minor },
      },
    );
  });

  it("JPY 1.5 is 'Too many decimal places'", () => {
    expect(
      conditionFromDraft(draft({ field: "amount_spent", op: "eq", text: "1.5" }), "JPY"),
    ).toEqual({
      ok: false,
      field: "valueMinor",
      error: "tooManyDecimals",
    });
  });

  it("EGP 0.295 is too many decimals; blank is required; letters are not an amount", () => {
    const errorOf = (text: string) =>
      conditionFromDraft(draft({ field: "amount_spent", op: "eq", text }), "EGP");
    expect(errorOf("0.295")).toMatchObject({ ok: false, error: "tooManyDecimals" });
    expect(errorOf("  ")).toMatchObject({ ok: false, error: "required" });
    expect(errorOf("12a")).toMatchObject({ ok: false, error: "invalidAmount" });
    expect(errorOf("-5")).toMatchObject({ ok: false, error: "invalidAmount" });
  });

  it("a saved amount shows in major units of the shop currency", () => {
    const row = (currency: string, valueMinor: number) =>
      draftFromCondition({ field: "amount_spent", op: "gt", valueMinor }, currency, "r").text;
    expect(row("EGP", 29)).toBe("0.29");
    expect(row("JPY", 29)).toBe("29");
    expect(row("KWD", 29)).toBe("0.029");
  });
});

describe("conditionFromDraft", () => {
  it("orders: a whole number with the chosen operator; blanks and fractions are refused", () => {
    expect(
      conditionFromDraft(draft({ field: "orders_count", op: "gt", text: "3" }), "EGP"),
    ).toEqual({
      ok: true,
      condition: { field: "orders_count", op: "gt", value: 3 },
    });
    expect(conditionFromDraft(draft({ field: "orders_count", text: "" }), "EGP")).toMatchObject({
      ok: false,
      field: "value",
      error: "required",
    });
    expect(conditionFromDraft(draft({ field: "orders_count", text: "1.5" }), "EGP")).toMatchObject({
      ok: false,
      error: "wholeNumber",
    });
    expect(conditionFromDraft(draft({ field: "orders_count", text: "٣" }), "EGP")).toMatchObject({
      ok: true,
      condition: { value: 3 },
    });
  });

  it("last order / created date: days, dates and 'never'", () => {
    expect(
      conditionFromDraft(
        draft({ field: "last_order_date", op: "within_last_days", text: "30" }),
        "EGP",
      ),
    ).toEqual({
      ok: true,
      condition: { field: "last_order_date", op: "within_last_days", days: 30 },
    });
    expect(
      conditionFromDraft(draft({ field: "created_date", op: "before", text: "2026-02-28" }), "EGP"),
    ).toEqual({ ok: true, condition: { field: "created_date", op: "before", date: "2026-02-28" } });
    expect(
      conditionFromDraft(draft({ field: "created_date", op: "before", text: "2026-02-30" }), "EGP"),
    ).toMatchObject({ ok: false, field: "date", error: "invalidDate" });
    expect(conditionFromDraft(draft({ field: "last_order_date", op: "never" }), "EGP")).toEqual({
      ok: true,
      condition: { field: "last_order_date", op: "never" },
    });
    expect(
      conditionFromDraft(
        draft({ field: "last_order_date", op: "not_within_last_days", text: "x" }),
        "EGP",
      ),
    ).toMatchObject({ ok: false, field: "days", error: "wholeNumber" });
  });

  it("subscriptions carry the yes/no; language eq / neq / unset", () => {
    expect(conditionFromDraft(draft({ field: "email_subscribed", flag: false }), "EGP")).toEqual({
      ok: true,
      condition: { field: "email_subscribed", value: false },
    });
    expect(conditionFromDraft(draft({ field: "sms_subscribed" }), "EGP")).toEqual({
      ok: true,
      condition: { field: "sms_subscribed", value: true },
    });
    expect(
      conditionFromDraft(draft({ field: "language", op: "neq", language: "ar" }), "EGP"),
    ).toEqual({ ok: true, condition: { field: "language", op: "neq", value: "ar" } });
    expect(conditionFromDraft(draft({ field: "language", op: "unset" }), "EGP")).toEqual({
      ok: true,
      condition: { field: "language", op: "unset" },
    });
  });

  it("tags de-duplicate with the Wave 1b tagKeyOf (case, spacing, NFC) and need at least one", () => {
    expect(
      conditionFromDraft(
        draft({
          field: "tags",
          op: "has_all",
          values: ["VIP", " vip ", "Gold  Card", "gold card"],
        }),
        "EGP",
      ),
    ).toEqual({
      ok: true,
      condition: { field: "tags", op: "has_all", values: ["VIP", "Gold Card"] },
    });
    expect(conditionFromDraft(draft({ field: "tags", values: [] }), "EGP")).toMatchObject({
      ok: false,
      field: "values",
      error: "needTags",
    });
  });

  it("countries: trimmed, upper-cased, de-duplicated; Arabic comma works; bad codes refused", () => {
    expect(
      conditionFromDraft(draft({ field: "country", op: "not_in", text: "eg, SA،eg" }), "EGP"),
    ).toEqual({ ok: true, condition: { field: "country", op: "not_in", values: ["EG", "SA"] } });
    expect(
      conditionFromDraft(draft({ field: "country", op: "in", text: "EGY" }), "EGP"),
    ).toMatchObject({
      ok: false,
      error: "invalidCountries",
    });
    expect(
      conditionFromDraft(draft({ field: "country", op: "in", text: " , " }), "EGP"),
    ).toMatchObject({
      ok: false,
      error: "needCountries",
    });
    expect(parseCountries("eg")).toEqual(["EG"]);
  });
});

describe("row model", () => {
  it("every field offers operators, the first of which is the default", () => {
    for (const field of SEGMENT_FIELDS) {
      expect(newDraft("x", field).op).toBe(OPS_BY_FIELD[field][0] ?? "");
    }
    expect(valueKind("last_order_date", "never")).toBe("none");
    expect(valueKind("email_subscribed", "")).toBe("flag");
  });

  it("changing the field resets the row; changing the operator keeps text of the same kind", () => {
    const typed = draft({ field: "orders_count", op: "gt", text: "5" });
    expect(withField(typed, "amount_spent")).toMatchObject({
      field: "amount_spent",
      op: "eq",
      text: "",
    });
    expect(withOp(typed, "lt").text).toBe("5");
    const days = draft({ field: "created_date", op: "within_last_days", text: "30" });
    expect(withOp(days, "not_within_last_days").text).toBe("30");
    expect(withOp(days, "before").text).toBe("");
  });

  it("conditionsFromDrafts is null while any row is incomplete or there are no rows", () => {
    const good = draft({ field: "orders_count", op: "gte", text: "1" });
    expect(conditionsFromDrafts([], "EGP")).toBeNull();
    expect(
      conditionsFromDrafts([good, draft({ field: "orders_count", text: "" })], "EGP"),
    ).toBeNull();
    expect(conditionsFromDrafts([good], "EGP")).toEqual([
      { field: "orders_count", op: "gte", value: 1 },
    ]);
  });

  it.each<SegmentCondition>([
    { field: "orders_count", op: "eq", value: 0 },
    { field: "amount_spent", op: "lte", valueMinor: 12345 },
    { field: "last_order_date", op: "within_last_days", days: 14 },
    { field: "last_order_date", op: "on_or_after", date: "2026-01-02" },
    { field: "last_order_date", op: "never" },
    { field: "email_subscribed", value: true },
    { field: "sms_subscribed", value: false },
    { field: "tags", op: "has_any", values: ["VIP", "جديد"] },
    { field: "country", op: "in", values: ["EG", "SA"] },
    { field: "created_date", op: "not_within_last_days", days: 7 },
    { field: "language", op: "eq", value: "ar" },
    { field: "language", op: "unset" },
  ])("round-trips %j through a draft", (condition) => {
    const row = draftFromCondition(condition, "EGP", "r");
    expect(conditionFromDraft(row, "EGP")).toEqual({ ok: true, condition });
  });
});
