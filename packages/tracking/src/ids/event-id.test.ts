import { beforeEach, describe, expect, it } from "vitest";

import { businessEventId, checkProvidedDedupId, newBrowserEventId } from "./event-id";

describe("Morbeh event ids", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("builds a browser id from a UUID", () => {
    expect(newBrowserEventId(() => "3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(
      "mb_3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    );
    expect(() => newBrowserEventId(() => "x")).toThrow(RangeError);
  });
  it("builds business ids", () => {
    expect(businessEventId("lead", " a1b2 ")).toBe("lead_a1b2");
    expect(businessEventId("order", "7c9e6679-7425-40de-944b-e07fc1f90ae7")).toBe(
      "ord_7c9e6679-7425-40de-944b-e07fc1f90ae7",
    );
    expect(businessEventId("delivery", "o-1")).toBe("dlv_o-1");
    expect(businessEventId("cancel", "o-1")).toBe("cnl_o-1");
  });
  it.each([
    "",
    "  ",
    "undefined",
    "NULL",
    "na",
    "{{order.id}}",
    "%OrderId%",
    "a".repeat(65),
    "o_1",
  ])("rejects the business ref %j", (bad) => {
    expect(() => businessEventId("order", bad)).toThrow(RangeError);
  });
  it.each([
    [undefined, "absent"],
    ["lead_a1b2", "valid"],
    ["mb_3f2504e0-4f89-41d3-9a0c-0305e82c3301", "valid"],
    ["b12a7c358b87131b5cef5a3e69a5d474532a78e4a3183971b2c70f67c8bb3c8f", "valid"],
    [null, "invalid"],
    ["", "invalid"],
    ["undefined", "invalid"],
    ["lead_undefined", "invalid"],
    ["ord_NULL", "invalid"],
    ["cnl_NA", "invalid"],
    ["mb_x", "invalid"],
    ["{{order.id}}", "invalid"],
    ["%OrderId%", "invalid"],
    ["evt_1", "invalid"],
    ["lead_", "invalid"],
    [42, "invalid"],
    [{}, "invalid"],
  ])("checkProvidedDedupId(%j) → %s", (value, expected) => {
    expect(checkProvidedDedupId(value)).toBe(expected);
  });
});
