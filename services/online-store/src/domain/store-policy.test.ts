import { describe, expect, it } from "vitest";
import { StorePolicy } from "./store-policy";

const now = new Date("2026-11-04T10:00:00.000Z");

describe("StorePolicy (spec 2.3)", () => {
  it("an empty policy is not set and has no locales", () => {
    const p = StorePolicy.empty("refund");
    expect(p.isSet).toBe(false);
    expect(p.locales).toEqual([]);
    expect(p.snapshot()).toMatchObject({
      type: "refund",
      version: 0,
      persisted: false,
      updatedBy: null,
    });
  });
  it("one locale is enough to be set; update records who and when", () => {
    const p = StorePolicy.empty("shipping");
    p.update({ ar: "نص" }, "staff-1", now);
    expect(p.isSet).toBe(true);
    expect(p.locales).toEqual(["ar"]);
    expect(p.snapshot()).toMatchObject({
      body: { ar: "نص" },
      updatedBy: "staff-1",
      updatedAt: now,
    });
    expect(p.nextVersion).toBe(1);
  });
  it("a persisted policy's next version is one more; blank text does not count as set", () => {
    const p = StorePolicy.reconstitute({
      type: "terms",
      body: { ar: "", en: "x" },
      updatedAt: null,
      updatedBy: null,
      version: 4,
      persisted: true,
    });
    expect(p.locales).toEqual(["en"]);
    expect(p.nextVersion).toBe(5);
  });
});
