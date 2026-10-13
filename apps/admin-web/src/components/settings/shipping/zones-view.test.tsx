import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import { formatCurrency } from "@/lib/format";
import type { ZoneDto } from "@/lib/shipping/zones";
import { ZonesView } from "./zones-view";

const actions = vi.hoisted(() => ({
  saveZoneAction: vi.fn(),
  saveRateAction: vi.fn(),
  deleteZoneAction: vi.fn(),
  deleteRateAction: vi.fn(),
  quickSetupAction: vi.fn(),
}));
vi.mock("@/app/settings/shipping/actions", () => actions);

beforeEach(() => {
  for (const fn of Object.values(actions)) {
    fn.mockReset().mockResolvedValue({ status: "success" } satisfies FormState);
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

const t = en.shippingSettings;

const zones: ZoneDto[] = [
  {
    id: "z-1",
    name: "Cairo and Giza",
    profile: "general",
    countries: [{ code: "EG", provinces: ["EG-C", "EG-GZ"] }],
    rates: [
      {
        id: "r-1",
        name: "Standard",
        priceMinor: 5000,
        condition: { type: "none" },
        description: "2–4 business days",
      },
      {
        id: "r-2",
        name: "Free over 1000",
        priceMinor: 0,
        condition: { type: "orderPrice", minMinor: 100_000 },
        description: null,
      },
      {
        id: "r-3",
        name: "Light parcel",
        priceMinor: 3000,
        condition: { type: "weight", minGrams: 0, maxGrams: 5000 },
        description: null,
      },
    ],
  },
  {
    id: "z-2",
    name: "Rest of world",
    profile: "general",
    countries: [{ code: "*", provinces: null }],
    rates: [],
  },
];

function renderView(list: ZoneDto[] = zones) {
  return render(
    <ZonesView zones={list} currency="EGP" weightUnit="kg" homeCountry="EG" t={en} locale="en" />,
  );
}

describe("ZonesView (Plan 3C)", () => {
  it("explains what to do when nothing is set up", () => {
    renderView([]);

    expect(screen.getByText(t.emptyState)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.createZone })).toBeInTheDocument();
  });

  it("offers the quick setup card above the empty state when there are no zones", () => {
    renderView([]);

    expect(screen.getByText(t.quickSetupTitle)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.quickSetupSave })).toBeInTheDocument();
  });

  it("hides the quick setup card once a zone exists", () => {
    renderView();

    expect(screen.queryByText(t.quickSetupTitle)).not.toBeInTheDocument();
  });

  it("lists each zone with its countries summarised", () => {
    renderView();

    const cairo = screen.getByRole("region", { name: "Cairo and Giza" });
    expect(within(cairo).getByText("Egypt (2 of 27 governorates)")).toBeInTheDocument();
    const world = screen.getByRole("region", { name: "Rest of world" });
    expect(within(world).getByText(t.restOfWorld, { selector: "p" })).toBeInTheDocument();
  });

  it("lists a zone's rates with condition and price, Free for zero", () => {
    renderView();
    const cairo = screen.getByRole("region", { name: "Cairo and Giza" });

    const rows = within(cairo).getAllByRole("row").slice(1);
    const cells = rows.map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    );
    expect(cells[0]?.slice(0, 3)).toEqual([
      "Standard2–4 business days",
      t.noCondition,
      formatCurrency("en", 5000, "EGP"),
    ]);
    expect(cells[1]?.slice(0, 3)).toEqual([
      "Free over 1000",
      t.andUp.replace("{amount}", formatCurrency("en", 100_000, "EGP")),
      t.free,
    ]);
    expect(cells[2]?.slice(1, 3)).toEqual(["0–5 kg", formatCurrency("en", 3000, "EGP")]);
  });

  it("says a zone has no rates yet", () => {
    renderView();

    const world = screen.getByRole("region", { name: "Rest of world" });
    expect(within(world).getByText(t.noRates)).toBeInTheDocument();
  });

  it("opens the create-zone dialog, and the edit dialog with the zone's name", () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: t.createZone }));
    expect(screen.getByRole("dialog")).toHaveTextContent(t.createZone);
  });

  it("opens the edit-zone dialog with the zone's name", () => {
    renderView();
    const cairo = screen.getByRole("region", { name: "Cairo and Giza" });

    fireEvent.click(within(cairo).getByRole("button", { name: t.editZone }));

    expect(screen.getByRole("dialog")).toHaveTextContent(t.editZone);
    expect(screen.getByLabelText(t.zoneName)).toHaveValue("Cairo and Giza");
  });

  it("opens the add-rate dialog for that zone, and the edit dialog for a rate", () => {
    renderView();
    const cairo = screen.getByRole("region", { name: "Cairo and Giza" });

    fireEvent.click(within(cairo).getByRole("button", { name: t.addRate }));
    expect(screen.getByRole("dialog")).toHaveTextContent(t.addRate);
    expect((document.querySelector('input[name="zoneId"]') as HTMLInputElement).value).toBe("z-1");
  });

  it("opens the edit dialog for a rate with its values", () => {
    renderView();
    const cairo = screen.getByRole("region", { name: "Cairo and Giza" });

    fireEvent.click(within(cairo).getAllByRole("button", { name: t.edit })[0]!);

    expect(screen.getByRole("dialog")).toHaveTextContent(t.editRate);
    expect(screen.getByLabelText(t.rateName)).toHaveValue("Standard");
  });

  it("asks before deleting a zone, naming it, and deletes only when confirmed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderView();
    const cairo = screen.getByRole("region", { name: "Cairo and Giza" });

    fireEvent.click(within(cairo).getByRole("button", { name: t.deleteZone }));
    expect(confirm).toHaveBeenCalledWith(t.confirmDeleteZone.replace("{name}", "Cairo and Giza"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(actions.deleteZoneAction).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(within(cairo).getByRole("button", { name: t.deleteZone }));
    await vi.waitFor(() => expect(actions.deleteZoneAction).toHaveBeenCalledTimes(1));
    expect(actions.deleteZoneAction.mock.calls[0]?.[1].get("zoneId")).toBe("z-1");
  });

  it("asks before deleting a rate and deletes it under its zone", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderView();
    const cairo = screen.getByRole("region", { name: "Cairo and Giza" });

    fireEvent.click(within(cairo).getAllByRole("button", { name: t.deleteRate })[1]!);

    await vi.waitFor(() => expect(actions.deleteRateAction).toHaveBeenCalledTimes(1));
    const data = actions.deleteRateAction.mock.calls[0]?.[1];
    expect(data.get("zoneId")).toBe("z-1");
    expect(data.get("rateId")).toBe("r-2");
  });
});
