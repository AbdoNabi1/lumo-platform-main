import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";

const taxes = vi.hoisted(() => ({
  updateTaxFlags: vi.fn(),
  upsertTaxRegion: vi.fn(),
  deleteTaxRegion: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/taxes", () => taxes);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { deleteRegionAction, saveRegionAction, saveTaxFlagsAction } = await import("./actions");

const idle: FormState = { status: "idle" };

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.append(name, value);
  return formData;
}

beforeEach(() => {
  for (const fn of Object.values(taxes))
    fn.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  revalidatePath.mockReset();
});

describe("saveTaxFlagsAction", () => {
  it("reads the two switches as on/off and saves them", async () => {
    const state = await saveTaxFlagsAction(idle, form({ pricesIncludeTax: "on" }));

    expect(state).toEqual({ status: "success" });
    expect(taxes.updateTaxFlags).toHaveBeenCalledWith(
      { pricesIncludeTax: true, chargeTaxOnShipping: false },
      expect.any(String),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/settings/taxes");
  });

  it("both on, both off", async () => {
    await saveTaxFlagsAction(idle, form({ pricesIncludeTax: "on", chargeTaxOnShipping: "on" }));
    await saveTaxFlagsAction(idle, form({}));

    expect(taxes.updateTaxFlags.mock.calls[0]?.[0]).toEqual({
      pricesIncludeTax: true,
      chargeTaxOnShipping: true,
    });
    expect(taxes.updateTaxFlags.mock.calls[1]?.[0]).toEqual({
      pricesIncludeTax: false,
      chargeTaxOnShipping: false,
    });
  });

  it("reports a failed save and does not refresh", async () => {
    taxes.updateTaxFlags.mockResolvedValue({ outcome: "error", message: "down" });

    expect((await saveTaxFlagsAction(idle, form({}))).status).toBe("error");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("saveRegionAction", () => {
  it("saves a country's rate as basis points, with its province rates", async () => {
    const state = await saveRegionAction(
      idle,
      form({
        country: "EG",
        rate: "14",
        overrides: JSON.stringify([{ code: "EG-C", rate: "10" }]),
      }),
    );

    expect(state).toEqual({ status: "success" });
    expect(taxes.upsertTaxRegion).toHaveBeenCalledWith(
      "EG",
      { rateBasisPoints: 1400, provinces: [{ code: "EG-C", rateBasisPoints: 1000 }] },
      expect.any(String),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/settings/taxes");
  });

  it("accepts two decimals, with or without a percent sign", async () => {
    await saveRegionAction(idle, form({ country: "SA", rate: "14.25%", overrides: "[]" }));

    expect(taxes.upsertTaxRegion.mock.calls[0]?.[1]).toMatchObject({ rateBasisPoints: 1425 });
  });

  it("names the field when the rate is not a percent, before any request", async () => {
    for (const rate of ["", "abc", "101", "14.375", "-1"]) {
      const state = await saveRegionAction(idle, form({ country: "EG", rate, overrides: "[]" }));
      expect(state).toMatchObject({ status: "error", fieldErrors: { rate: expect.any(String) } });
    }
    expect(taxes.upsertTaxRegion).not.toHaveBeenCalled();
  });

  it("names the overrides when one of them is not a percent", async () => {
    const state = await saveRegionAction(
      idle,
      form({ country: "EG", rate: "14", overrides: JSON.stringify([{ code: "EG-C", rate: "x" }]) }),
    );

    expect(state).toMatchObject({
      status: "error",
      fieldErrors: { overrides: expect.any(String) },
    });
    expect(taxes.upsertTaxRegion).not.toHaveBeenCalled();
  });

  it("refuses overrides that are not a list of {code, rate}, and a missing country", async () => {
    for (const overrides of ["not json", "{}", JSON.stringify([{ code: 5 }])]) {
      expect(
        (await saveRegionAction(idle, form({ country: "EG", rate: "14", overrides }))).status,
      ).toBe("error");
    }
    expect((await saveRegionAction(idle, form({ rate: "14", overrides: "[]" }))).status).toBe(
      "error",
    );
    expect(taxes.upsertTaxRegion).not.toHaveBeenCalled();
  });

  it("shows the API's message, for example an unknown province", async () => {
    taxes.upsertTaxRegion.mockResolvedValue({
      outcome: "invalid",
      message: "Invalid tax region",
      fields: [{ field: "provinces", message: "SA-01 is not a province of EG" }],
    });

    const state = await saveRegionAction(
      idle,
      form({ country: "EG", rate: "14", overrides: "[]" }),
    );

    expect(state).toMatchObject({
      status: "error",
      fieldErrors: { provinces: "SA-01 is not a province of EG" },
    });
  });
});

describe("deleteRegionAction", () => {
  it("removes the country's region and refreshes", async () => {
    expect(await deleteRegionAction(idle, form({ country: "EG" }))).toEqual({ status: "success" });
    expect(taxes.deleteTaxRegion).toHaveBeenCalledWith("EG", expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/settings/taxes");
  });

  it("refuses a delete with no country", async () => {
    expect((await deleteRegionAction(idle, form({}))).status).toBe("error");
    expect(taxes.deleteTaxRegion).not.toHaveBeenCalled();
  });
});
