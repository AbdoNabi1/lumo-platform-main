import { ConcurrencyError } from "@platform/utils";
import { beforeEach, describe, expect, it } from "vitest";
import { MerchantCarrierSettings } from "../domain/merchant-carrier-settings";
import { InMemoryMerchantCarrierSettingsRepository } from "./in-memory-merchant-carrier-settings-repository";

beforeEach(() => {
  expect.hasAssertions();
});

const stored = {
  config: {},
  sealedCredentials: "sealed",
  webhook: { sealedSecret: "sealed-secret" },
};

describe("InMemoryMerchantCarrierSettingsRepository (same version contract as Prisma)", () => {
  it("keys by tenant and versions every save from 1", async () => {
    const repo = new InMemoryMerchantCarrierSettingsRepository();
    expect(await repo.get("t-1")).toBeNull();

    await repo.save(MerchantCarrierSettings.empty().withCarrier("bosta", stored), "t-1");
    const loaded = (await repo.get("t-1"))!;
    expect(loaded.version).toBe(1);
    expect(await repo.get("t-2")).toBeNull();

    await repo.save(loaded.withEnabled("bosta", true), "t-1");
    expect((await repo.get("t-1"))?.version).toBe(2);
    expect((await repo.get("t-1"))?.isEnabled("bosta")).toBe(true);
  });

  it("copies nested settings on save and on read", async () => {
    const repo = new InMemoryMerchantCarrierSettingsRepository();
    const config = { nested: { value: "initial" } };
    const expiry = new Date("2026-11-19T00:00:00.000Z");
    await repo.save(
      MerchantCarrierSettings.empty().withCarrier("bosta", {
        config,
        sealedCredentials: "sealed",
        webhook: {
          sealedSecret: "current",
          previousSealedSecret: "old",
          previousValidUntil: expiry,
        },
      }),
      "t-1",
    );
    config.nested.value = "changed";
    expiry.setTime(0);
    const first = (await repo.get("t-1"))!;
    expect(first.carrier("bosta")?.config).toEqual({ nested: { value: "initial" } });
    expect(first.carrier("bosta")?.webhook.previousValidUntil?.toISOString()).toBe(
      "2026-11-19T00:00:00.000Z",
    );
    (first.carrier("bosta")?.config.nested as { value: string }).value = "changed again";
    expect((await repo.get("t-1"))?.carrier("bosta")?.config).toEqual({
      nested: { value: "initial" },
    });
  });

  it("a stale save, or a second first-save, is a ConcurrencyError", async () => {
    const repo = new InMemoryMerchantCarrierSettingsRepository();
    await repo.save(MerchantCarrierSettings.empty(), "t-1");
    await expect(repo.save(MerchantCarrierSettings.empty(), "t-1")).rejects.toBeInstanceOf(
      ConcurrencyError,
    );

    const loaded = (await repo.get("t-1"))!;
    await repo.save(loaded.withCarrier("bosta", stored), "t-1");
    await expect(repo.save(loaded, "t-1")).rejects.toBeInstanceOf(ConcurrencyError);
    expect((await repo.get("t-1"))?.carrier("bosta")).toEqual(stored);
  });
});
