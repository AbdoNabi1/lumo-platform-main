import { describe, expect, it } from "vitest";
import { ConcurrencyError, type ValidationError } from "@platform/utils";
import {
  DEFAULT_CHECKOUT_SETTINGS,
  type CheckoutSettingsValues,
} from "../domain/checkout-settings";
import { InMemoryCheckoutSettingsRepository } from "../infrastructure/in-memory-checkout-settings-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { GetCheckoutSettings, UpdateCheckoutSettings } from "./checkout-settings.use-cases";

const changed: CheckoutSettingsValues = {
  ...DEFAULT_CHECKOUT_SETTINGS,
  phoneMode: "optional",
  cartLineLimit: 4,
};

function setup() {
  const settings = new InMemoryCheckoutSettingsRepository();
  return {
    settings,
    get: new GetCheckoutSettings({ settings }),
    update: new UpdateCheckoutSettings({ settings, unitOfWork: new InMemoryUnitOfWork() }),
  };
}

describe("GetCheckoutSettings", () => {
  it("returns the defaults and a null version for a shop with no row", async () => {
    const { get } = setup();
    const result = await get.execute({ tenantId: "t1" });
    expect(result.ok && result.value).toEqual({ values: DEFAULT_CHECKOUT_SETTINGS, version: null });
  });

  it("returns what was saved with its version", async () => {
    const { get, update } = setup();
    await update.execute({ tenantId: "t1", expectedVersion: null, values: changed });
    const result = await get.execute({ tenantId: "t1" });
    expect(result.ok && result.value).toEqual({ values: changed, version: 1 });
  });

  it("is per tenant", async () => {
    const { get, update } = setup();
    await update.execute({ tenantId: "t1", expectedVersion: null, values: changed });
    const other = await get.execute({ tenantId: "t2" });
    expect(other.ok && other.value).toEqual({ values: DEFAULT_CHECKOUT_SETTINGS, version: null });
  });
});

describe("UpdateCheckoutSettings", () => {
  it("creates the first row at version 1 when expectedVersion is null", async () => {
    const { update } = setup();
    const result = await update.execute({ tenantId: "t1", expectedVersion: null, values: changed });
    expect(result.ok && result.value).toEqual({ values: changed, version: 1 });
  });

  it("updates at the version that was read and bumps it", async () => {
    const { update } = setup();
    await update.execute({ tenantId: "t1", expectedVersion: null, values: changed });
    const result = await update.execute({
      tenantId: "t1",
      expectedVersion: 1,
      values: DEFAULT_CHECKOUT_SETTINGS,
    });
    expect(result.ok && result.value).toEqual({ values: DEFAULT_CHECKOUT_SETTINGS, version: 2 });
  });

  it("a stale version is a CONFLICT and nothing is written", async () => {
    const { update, get } = setup();
    await update.execute({ tenantId: "t1", expectedVersion: null, values: changed });
    await update.execute({ tenantId: "t1", expectedVersion: 1, values: DEFAULT_CHECKOUT_SETTINGS });

    const stale = await update.execute({ tenantId: "t1", expectedVersion: 1, values: changed });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.code).toBe("CONFLICT");
    expect(stale.error.message).toBe("These settings were changed by someone else");
    const now = await get.execute({ tenantId: "t1" });
    expect(now.ok && now.value).toEqual({ values: DEFAULT_CHECKOUT_SETTINGS, version: 2 });
  });

  it("a page that loaded defaults (null) loses to a row someone created meanwhile", async () => {
    const { update } = setup();
    await update.execute({ tenantId: "t1", expectedVersion: null, values: changed });
    const late = await update.execute({
      tenantId: "t1",
      expectedVersion: null,
      values: DEFAULT_CHECKOUT_SETTINGS,
    });
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.error.code).toBe("CONFLICT");
  });

  it("a write race the repository detects is also a CONFLICT with the same message", async () => {
    const { settings, update } = setup();
    settings.save = () => Promise.reject(new ConcurrencyError("raced"));
    const result = await update.execute({ tenantId: "t1", expectedVersion: null, values: changed });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CONFLICT");
    expect(result.error.message).toBe("These settings were changed by someone else");
  });

  it("an invalid document is a VALIDATION error naming the field, and nothing is saved", async () => {
    const { update, get } = setup();
    const result = await update.execute({
      tenantId: "t1",
      expectedVersion: null,
      values: { ...changed, requireLogin: true, accountsMode: "disabled" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    expect((result.error as ValidationError).fields).toEqual([
      { field: "requireLogin", message: "Customer accounts must be on to require login" },
    ]);
    const now = await get.execute({ tenantId: "t1" });
    expect(now.ok && now.value.version).toBeNull();
  });
});
