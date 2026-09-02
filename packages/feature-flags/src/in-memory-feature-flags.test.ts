import { describe, expect, it } from "vitest";
import { InMemoryFeatureFlags } from "./in-memory-feature-flags";

const context = { subjectId: "user-1" };

describe("InMemoryFeatureFlags", () => {
  it("returns the configured value for a known flag", async () => {
    const flags = new InMemoryFeatureFlags({
      "checkout.express": true,
      "checkout.gift_wrap": false,
    });
    expect(await flags.isEnabled("checkout.express", context)).toBe(true);
    expect(await flags.isEnabled("checkout.gift_wrap", context)).toBe(false);
  });

  it("disables unknown flags by default (kill-switch safe)", async () => {
    const flags = new InMemoryFeatureFlags();
    expect(await flags.isEnabled("missing.flag", context)).toBe(false);
  });

  it("ignores the evaluation context (no rollout or targeting yet)", async () => {
    const flags = new InMemoryFeatureFlags({ "catalog.new_pdp": true });
    expect(await flags.isEnabled("catalog.new_pdp", { subjectId: "x" })).toBe(true);
    expect(await flags.isEnabled("catalog.new_pdp", { subjectId: "y" })).toBe(true);
  });
});
