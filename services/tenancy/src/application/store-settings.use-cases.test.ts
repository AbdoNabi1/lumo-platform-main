import { describe, expect, it } from "vitest";
import { ValidationError } from "@platform/utils";
import { InMemoryStoreSettingsRepository } from "../infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { GetPublicStore, GetStoreSettings, UpdateStoreSettings } from "./store-settings.use-cases";

function harness() {
  const settings = new InMemoryStoreSettingsRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  return {
    settings,
    get: new GetStoreSettings({ settings }),
    update: new UpdateStoreSettings({ settings, unitOfWork }),
    publicStore: new GetPublicStore({ settings }),
  };
}

const input = {
  storeName: "Lumo",
  contactEmail: "hello@lumo.test",
  currency: "SAR",
  timezone: "Asia/Riyadh",
  weightUnit: "g",
};

describe("GetStoreSettings", () => {
  it("returns the defaults when the shop has saved nothing", async () => {
    const result = await harness().get.execute({});
    expect(result).toEqual({
      ok: true,
      value: {
        storeName: "",
        contactEmail: null,
        currency: "EGP",
        timezone: "Africa/Cairo",
        weightUnit: "kg",
      },
    });
  });
});

describe("UpdateStoreSettings", () => {
  it("saves and then reads back what was saved", async () => {
    const h = harness();
    const saved = await h.update.execute(input);
    expect(saved.ok).toBe(true);
    const read = await h.get.execute({});
    expect(read.ok && read.value).toMatchObject({ storeName: "Lumo", currency: "SAR" });
  });

  it("replaces the previous values wholesale", async () => {
    const h = harness();
    await h.update.execute(input);
    await h.update.execute({ ...input, currency: "AED", contactEmail: null });
    const read = await h.get.execute({});
    expect(read.ok && read.value).toMatchObject({ currency: "AED", contactEmail: null });
  });

  it("returns a validation error and saves nothing for invalid input", async () => {
    const h = harness();
    const result = await h.update.execute({ ...input, currency: "XXX" });
    expect(!result.ok && result.error).toBeInstanceOf(ValidationError);
    const read = await h.get.execute({});
    expect(read.ok && read.value.currency).toBe("EGP");
  });
});

describe("GetPublicStore", () => {
  it("exposes only the name and the currency", async () => {
    const h = harness();
    await h.update.execute(input);
    const result = await h.publicStore.execute({});
    expect(result).toEqual({ ok: true, value: { name: "Lumo", currency: "SAR" } });
  });

  it("answers with the defaults before anything is saved", async () => {
    const result = await harness().publicStore.execute({});
    expect(result).toEqual({ ok: true, value: { name: "", currency: "EGP" } });
  });
});
