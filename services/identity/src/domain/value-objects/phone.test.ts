import { describe, expect, it } from "vitest";
import { Phone } from "./phone";
describe("Phone", () => {
  it("normalizes separators", () => {
    expect.hasAssertions();
    expect(Phone.create("010 1234-5678")).toMatchObject({
      ok: true,
      value: { value: "01012345678" },
    });
    expect(Phone.create("+20 (10) 1234 5678")).toMatchObject({
      ok: true,
      value: { value: "+201012345678" },
    });
  });
  it("rejects short and alphabetic values", () => {
    for (const raw of ["12345", "abc1234567"])
      expect(Phone.create(raw)).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });
});
