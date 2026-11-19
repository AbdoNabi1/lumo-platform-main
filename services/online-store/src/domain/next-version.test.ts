import { describe, expect, it } from "vitest";
import { StorefrontPreferences } from "./storefront-preferences";
import { StorefrontTheme } from "./storefront-theme";

describe("nextVersion (the version a row carries after a successful save)", () => {
  it("preferences: 1 when never saved, version + 1 once persisted", () => {
    expect(StorefrontPreferences.defaults().nextVersion).toBe(1);
    const persisted = StorefrontPreferences.reconstitute({
      ...StorefrontPreferences.defaults().snapshot(),
      version: 7,
      persisted: true,
    });
    expect(persisted.nextVersion).toBe(8);
  });

  it("theme: 1 when never saved, version + 1 once persisted", () => {
    expect(StorefrontTheme.initial().nextVersion).toBe(1);
    const persisted = StorefrontTheme.reconstitute({
      ...StorefrontTheme.initial().snapshot(),
      version: 2,
      persisted: true,
    });
    expect(persisted.nextVersion).toBe(3);
  });
});
