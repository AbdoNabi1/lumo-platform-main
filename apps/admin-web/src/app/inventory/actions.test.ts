import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";

const inventory = vi.hoisted(() => ({
  registerWarehouse: vi.fn(),
  deactivateWarehouse: vi.fn(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/inventory", () => ({
  adjustStock: vi.fn(),
  commitReservation: vi.fn(),
  deactivateWarehouse: inventory.deactivateWarehouse,
  receiveStock: vi.fn(),
  registerWarehouse: inventory.registerWarehouse,
  releaseReservation: vi.fn(),
  reserveStock: vi.fn(),
  transferStock: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { addLocationAction, deactivateLocationAction } = await import("./actions");

const idle: FormState = { status: "idle" };

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  return formData;
}

beforeEach(() => {
  inventory.registerWarehouse.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  inventory.deactivateWarehouse.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  revalidatePath.mockReset();
});

describe("addLocationAction (Plan 2B-3)", () => {
  it("registers the location by name, deriving its code from the name", async () => {
    const state = await addLocationAction(idle, form({ name: "Nasr City" }));

    expect(state).toEqual({ status: "success" });
    expect(inventory.registerWarehouse).toHaveBeenCalledWith(
      { code: "NASR-CITY", name: "Nasr City" },
      expect.any(String),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/inventory");
  });

  it("gives an Arabic-only name a LOC-XXXX code", async () => {
    await addLocationAction(idle, form({ name: "فرع مدينة نصر" }));

    const [input] = inventory.registerWarehouse.mock.calls[0]!;
    expect(input.name).toBe("فرع مدينة نصر");
    expect(input.code).toMatch(/^LOC-[A-Z0-9]{4}$/);
  });

  it("trims the name", async () => {
    await addLocationAction(idle, form({ name: "  Alex  " }));

    expect(inventory.registerWarehouse).toHaveBeenCalledWith(
      { code: "ALEX", name: "Alex" },
      expect.any(String),
    );
  });

  it("refuses a blank name without calling the API", async () => {
    const state = await addLocationAction(idle, form({ name: "   " }));

    expect(state.status).toBe("error");
    if (state.status === "error") expect(state.fieldErrors["name"]).toBeDefined();
    expect(inventory.registerWarehouse).not.toHaveBeenCalled();
  });

  it("retries once with a suffixed code when the derived one is taken", async () => {
    inventory.registerWarehouse
      .mockResolvedValueOnce({ outcome: "conflict", message: "code exists" })
      .mockResolvedValueOnce({ outcome: "ok", data: {} });

    const state = await addLocationAction(idle, form({ name: "Nasr City" }));

    expect(state).toEqual({ status: "success" });
    expect(inventory.registerWarehouse).toHaveBeenCalledTimes(2);
    const [second] = inventory.registerWarehouse.mock.calls[1]!;
    expect(second.code).toMatch(/^NASR-CITY-[A-Z0-9]{4}$/);
  });

  it("shows the failure and does not refresh when registering fails", async () => {
    inventory.registerWarehouse.mockResolvedValue({ outcome: "error", message: "boom" });

    const state = await addLocationAction(idle, form({ name: "Nasr City" }));

    expect(state.status).toBe("error");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deactivateLocationAction (Plan 2B-3)", () => {
  it("deactivates the posted warehouse and refreshes the page", async () => {
    const state = await deactivateLocationAction(idle, form({ warehouseId: "w1" }));

    expect(state).toEqual({ status: "success" });
    expect(inventory.deactivateWarehouse).toHaveBeenCalledWith("w1", expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/inventory");
  });

  it("refuses a missing id without calling the API", async () => {
    const state = await deactivateLocationAction(idle, form({}));

    expect(state.status).toBe("error");
    expect(inventory.deactivateWarehouse).not.toHaveBeenCalled();
  });

  it("shows the failure and does not refresh when deactivating fails", async () => {
    inventory.deactivateWarehouse.mockResolvedValue({ outcome: "error", message: "boom" });

    const state = await deactivateLocationAction(idle, form({ warehouseId: "w1" }));

    expect(state.status).toBe("error");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
