import { describe, expect, it } from "vitest";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { Theme } from "./theme";
import { ThemeVariables } from "./value-objects/theme-variables";

function variables(): ThemeVariables {
  return ThemeVariables.create({ accent: "#635bff" }, { fontSans: "sans-serif" }, { root: "14px" });
}

describe("Theme", () => {
  it("starts at draft", () => {
    const theme = Theme.create(UniqueEntityId.from("theme-1"), "Default", variables());
    expect(theme.status).toBe("draft");
  });

  it("publishing appends a version snapshot", () => {
    const theme = Theme.create(UniqueEntityId.from("theme-1"), "Default", variables());
    theme.publish("evt-1", new Date(0));
    expect(theme.status).toBe("active");
    expect(theme.versions).toHaveLength(1);
  });

  it("rejects editing an archived theme", () => {
    const theme = Theme.create(UniqueEntityId.from("theme-1"), "Default", variables());
    theme.archive("evt-1", new Date(0));
    expect(() => theme.updateVariables(variables())).toThrow(BusinessRuleError);
  });

  it("rejects an illegal transition (archived -> active, 409)", () => {
    const theme = Theme.create(UniqueEntityId.from("theme-1"), "Default", variables());
    theme.archive("evt-1", new Date(0));
    expect(() => theme.transition("active", "evt-2", new Date(0))).toThrow(BusinessRuleError);
  });
});
