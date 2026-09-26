import { describe, expect, it } from "vitest";
import { InMemoryFeatureFlags } from "./in-memory-feature-flags";

const context = { subjectId: "user-1" };
const tenantId = "tenant-local";

describe("InMemoryFeatureFlags", () => {
  it("returns the configured value for a known flag", async () => {
    const flags = new InMemoryFeatureFlags({
      "checkout.express": true,
      "checkout.gift_wrap": false,
    });
    expect(await flags.isEnabled("checkout.express", tenantId, context)).toBe(true);
    expect(await flags.isEnabled("checkout.gift_wrap", tenantId, context)).toBe(false);
  });

  it("disables unknown flags by default (kill-switch safe)", async () => {
    const flags = new InMemoryFeatureFlags();
    expect(await flags.isEnabled("missing.flag", tenantId, context)).toBe(false);
  });

  it("ignores the evaluation context (no rollout or targeting yet)", async () => {
    const flags = new InMemoryFeatureFlags({ "catalog.new_pdp": true });
    expect(await flags.isEnabled("catalog.new_pdp", tenantId, { subjectId: "x" })).toBe(true);
    expect(await flags.isEnabled("catalog.new_pdp", tenantId, { subjectId: "y" })).toBe(true);
  });

  it("ignores tenantId too (static config, not tenant-scoped data)", async () => {
    const flags = new InMemoryFeatureFlags({ "checkout.express": true });
    expect(await flags.isEnabled("checkout.express", "tenant-a", context)).toBe(true);
    expect(await flags.isEnabled("checkout.express", "tenant-b", context)).toBe(true);
  });
});

describe("InMemoryFeatureFlags is platform-global by design (T10.7)", () => {
  it("answers every tenant from the same static map — it holds no tenant data, so it must not vary", async () => {
    const flags = new InMemoryFeatureFlags({ "checkout.express": true });
    await expect(flags.isEnabled("checkout.express", "tenant-a", { subjectId: "s" })).resolves.toBe(
      true,
    );
    await expect(flags.isEnabled("checkout.express", "tenant-b", { subjectId: "s" })).resolves.toBe(
      true,
    );
    await expect(flags.isEnabled("other", "tenant-a", { subjectId: "s" })).resolves.toBe(false);
  });
});
