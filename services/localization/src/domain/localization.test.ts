import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Locale } from "./locale";
import { TranslationSet } from "./translation-set";
import { LocaleCode } from "./value-objects/locale-code";

function code(value = "en-US"): LocaleCode {
  const result = LocaleCode.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

describe("Locale", () => {
  it("starts active", () => {
    const l = Locale.create(UniqueEntityId.from("locale-1"), code(), "English (US)", true);
    expect(l.status).toBe("active");
  });

  it("rejects deactivating the default locale", () => {
    const l = Locale.create(UniqueEntityId.from("locale-1"), code(), "English (US)", true);
    expect(() => l.deactivate("evt-1", new Date(0))).toThrow(BusinessRuleError);
  });

  it("deactivates a non-default locale", () => {
    const l = Locale.create(UniqueEntityId.from("locale-2"), code("fr"), "French", false);
    l.deactivate("evt-1", new Date(0));
    expect(l.status).toBe("inactive");
  });
});

describe("TranslationSet", () => {
  it("sets and resolves a published translation", () => {
    const set = TranslationSet.create(UniqueEntityId.from("set-1"), "locale-1", "storefront");
    set.setTranslation("welcome", "Welcome!", "evt-1", new Date(0));
    expect(set.resolve("welcome")).toBeUndefined();
    set.publishTranslation("welcome", "evt-2", new Date(0));
    expect(set.resolve("welcome")).toBe("Welcome!");
  });

  it("falls back when a key is missing", () => {
    const set = TranslationSet.create(UniqueEntityId.from("set-1"), "locale-1", "storefront");
    expect(set.resolve("missing", "default")).toBe("default");
  });

  it("removes a translation", () => {
    const set = TranslationSet.create(UniqueEntityId.from("set-1"), "locale-1", "storefront");
    set.setTranslation("welcome", "Welcome!", "evt-1", new Date(0));
    set.removeTranslation("welcome", "evt-2", new Date(0));
    expect(set.translations).toHaveLength(0);
  });
});
