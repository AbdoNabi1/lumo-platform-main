import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";

const zones = vi.hoisted(() => ({
  createShippingZone: vi.fn(),
  updateShippingZone: vi.fn(),
  deleteShippingZone: vi.fn(),
  addShippingRate: vi.fn(),
  updateShippingRate: vi.fn(),
  deleteShippingRate: vi.fn(),
}));
const settings = vi.hoisted(() => ({ fetchStoreSettings: vi.fn() }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/shipping-zones", () => zones);
vi.mock("@/lib/api/store-settings", () => settings);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { deleteRateAction, deleteZoneAction, saveRateAction, saveZoneAction } =
  await import("./actions");

const idle: FormState = { status: "idle" };

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.append(name, value);
  return formData;
}

beforeEach(() => {
  for (const fn of Object.values(zones))
    fn.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  settings.fetchStoreSettings.mockReset().mockResolvedValue({
    outcome: "ok",
    settings: {
      storeName: "Lumo",
      contactEmail: null,
      currency: "EGP",
      timezone: "Africa/Cairo",
      weightUnit: "kg",
    },
  });
  revalidatePath.mockReset();
});

const countries = [{ code: "EG", provinces: ["EG-C", "EG-GZ"] }];

describe("saveZoneAction", () => {
  it("creates a zone with the countries it was given, then refreshes the page", async () => {
    const state = await saveZoneAction(
      idle,
      form({ name: "  Cairo and Giza ", countries: JSON.stringify(countries) }),
    );

    expect(state).toEqual({ status: "success" });
    expect(zones.createShippingZone).toHaveBeenCalledWith(
      { name: "Cairo and Giza", countries },
      expect.any(String),
    );
    expect(zones.updateShippingZone).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/settings/shipping");
  });

  it("updates the zone when a zoneId is posted", async () => {
    await saveZoneAction(
      idle,
      form({ zoneId: "z-1", name: "Cairo", countries: JSON.stringify(countries) }),
    );

    expect(zones.updateShippingZone).toHaveBeenCalledWith(
      "z-1",
      { name: "Cairo", countries },
      expect.any(String),
    );
    expect(zones.createShippingZone).not.toHaveBeenCalled();
  });

  it("refuses countries that are not a list of {code, provinces}, before any request", async () => {
    for (const bad of [
      "not json",
      "{}",
      JSON.stringify([{ code: 5 }]),
      JSON.stringify([{ code: "EG", provinces: "EG-C" }]),
    ]) {
      const state = await saveZoneAction(idle, form({ name: "X", countries: bad }));
      expect(state.status).toBe("error");
    }
    expect(zones.createShippingZone).not.toHaveBeenCalled();
  });

  it("shows the API's message, for example the zone that already holds a country", async () => {
    zones.createShippingZone.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid shipping zone",
      fields: [{ field: "countries", message: 'EG is already in zone "Cairo and Giza"' }],
    });

    const state = await saveZoneAction(
      idle,
      form({ name: "X", countries: JSON.stringify(countries) }),
    );

    expect(state).toMatchObject({
      status: "error",
      fieldErrors: { countries: 'EG is already in zone "Cairo and Giza"' },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteZoneAction / deleteRateAction", () => {
  it("deletes the zone, and the rate under its zone", async () => {
    expect(await deleteZoneAction(idle, form({ zoneId: "z-1" }))).toEqual({ status: "success" });
    expect(zones.deleteShippingZone).toHaveBeenCalledWith("z-1", expect.any(String));

    expect(await deleteRateAction(idle, form({ zoneId: "z-1", rateId: "r-1" }))).toEqual({
      status: "success",
    });
    expect(zones.deleteShippingRate).toHaveBeenCalledWith("z-1", "r-1", expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/settings/shipping");
  });

  it("refuses a delete with no zone id", async () => {
    expect((await deleteZoneAction(idle, form({}))).status).toBe("error");
    expect(zones.deleteShippingZone).not.toHaveBeenCalled();
  });
});

describe("saveRateAction", () => {
  const base = {
    zoneId: "z-1",
    name: " Standard ",
    price: "50",
    conditionType: "none",
    min: "",
    max: "",
  };

  it("adds a rate priced in store-currency minor units, with no condition", async () => {
    const state = await saveRateAction(idle, form({ ...base, description: " 2–4 business days " }));

    expect(state).toEqual({ status: "success" });
    expect(zones.addShippingRate).toHaveBeenCalledWith(
      "z-1",
      {
        name: "Standard",
        priceMinor: 5000,
        condition: { type: "none" },
        description: "2–4 business days",
      },
      expect.any(String),
    );
  });

  it("sends no description when it is blank", async () => {
    await saveRateAction(idle, form({ ...base, description: "  " }));

    expect(zones.addShippingRate.mock.calls[0]?.[1]).toMatchObject({ description: null });
  });

  it("updates the rate when a rateId is posted", async () => {
    await saveRateAction(idle, form({ ...base, rateId: "r-1" }));

    expect(zones.updateShippingRate).toHaveBeenCalledWith(
      "z-1",
      "r-1",
      expect.objectContaining({ name: "Standard" }),
      expect.any(String),
    );
    expect(zones.addShippingRate).not.toHaveBeenCalled();
  });

  it("reads an order price condition in the store currency's minor units", async () => {
    await saveRateAction(
      idle,
      form({ ...base, price: "0", conditionType: "orderPrice", min: "1,000" }),
    );

    expect(zones.addShippingRate.mock.calls[0]?.[1]).toMatchObject({
      priceMinor: 0,
      condition: { type: "orderPrice", minMinor: 100_000 },
    });
  });

  it("reads a weight condition in the store's weight unit as grams", async () => {
    await saveRateAction(idle, form({ ...base, conditionType: "weight", min: "0", max: "5" }));

    expect(zones.addShippingRate.mock.calls[0]?.[1]).toMatchObject({
      condition: { type: "weight", minGrams: 0, maxGrams: 5000 },
    });
  });

  it("treats a condition with both bounds blank as no condition", async () => {
    await saveRateAction(idle, form({ ...base, conditionType: "weight" }));

    expect(zones.addShippingRate.mock.calls[0]?.[1]).toMatchObject({ condition: { type: "none" } });
  });

  it("names the field when the price or a bound is not a number, before any request", async () => {
    const badPrice = await saveRateAction(idle, form({ ...base, price: "abc" }));
    const badMin = await saveRateAction(idle, form({ ...base, conditionType: "weight", min: "x" }));

    expect(badPrice).toMatchObject({ status: "error", fieldErrors: { price: expect.any(String) } });
    expect(badMin).toMatchObject({ status: "error", fieldErrors: { min: expect.any(String) } });
    expect(zones.addShippingRate).not.toHaveBeenCalled();
  });

  it("does nothing when the store settings cannot be read, so no amount is guessed", async () => {
    settings.fetchStoreSettings.mockResolvedValue({ outcome: "error", message: "down" });

    const state = await saveRateAction(idle, form(base));

    expect(state.status).toBe("error");
    expect(zones.addShippingRate).not.toHaveBeenCalled();
  });

  it("projects the API's field errors, for example a minimum above the maximum", async () => {
    zones.addShippingRate.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid shipping zone",
      fields: [{ field: "condition", message: "the minimum must be below the maximum" }],
    });

    const state = await saveRateAction(
      idle,
      form({ ...base, conditionType: "weight", min: "5", max: "1" }),
    );

    expect(state).toMatchObject({
      status: "error",
      fieldErrors: { condition: "the minimum must be below the maximum" },
    });
  });
});
