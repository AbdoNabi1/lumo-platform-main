import { describe, expect, it } from "vitest";
import { validateProfile } from "./customer-input-validation";

describe("validateProfile", () => {
  it("aggregates invalid name, phone and language", () => {
    expect.hasAssertions();
    const result = validateProfile({ name: " ", phone: "abc", language: "fr" }, "create");
    expect(result.issues.map((issue) => issue.field)).toEqual(["name", "phone", "language"]);
    expect(validateProfile({ name: "😀".repeat(256) }, "update").issues[0]?.field).toBe("name");
    expect(validateProfile({ name: null }, "update").issues[0]?.field).toBe("name");
  });
  it("normalizes a valid profile using code points", () => {
    expect.hasAssertions();
    expect(
      validateProfile(
        { name: ` ${"😀".repeat(255)} `, phone: "+20 (10) 1234 5678", language: "ar" },
        "create",
      ),
    ).toEqual({
      value: { name: "😀".repeat(255), phone: "+201012345678", language: "ar" },
      issues: [],
    });
  });
  it("distinguishes create and update clearing and omitted values", () => {
    expect.hasAssertions();
    expect(validateProfile({ name: "X", phone: null }, "create").value).toEqual({ name: "X" });
    expect(validateProfile({ name: "X", phone: " " }, "create").value).toEqual({ name: "X" });
    expect(validateProfile({ phone: null, language: null }, "update").value).toEqual({
      phone: null,
      language: null,
    });
    expect(validateProfile({ phone: "" }, "update").value).toEqual({ phone: null });
    expect(validateProfile({ name: "X" }, "update").value).toEqual({ name: "X" });
    expect(validateProfile({}, "update").issues).toEqual([
      { field: "body", message: "provide at least one field" },
    ]);
  });
});
