import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import type { TaxRegionDto } from "@/lib/api/taxes";
import { RegionsView } from "./regions-view";

const actions = vi.hoisted(() => ({
  saveRegionAction: vi.fn(),
  deleteRegionAction: vi.fn(),
}));
vi.mock("@/app/settings/taxes/actions", () => actions);

beforeEach(() => {
  for (const fn of Object.values(actions)) {
    fn.mockReset().mockResolvedValue({ status: "success" } satisfies FormState);
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

const t = en.taxSettings;

const regions: TaxRegionDto[] = [
  {
    countryCode: "EG",
    rateBasisPoints: 1400,
    provinces: [
      { code: "EG-C", rateBasisPoints: 1000 },
      { code: "EG-GZ", rateBasisPoints: 1000 },
    ],
  },
  { countryCode: "SA", rateBasisPoints: 1500, provinces: [] },
];

function renderView(list: TaxRegionDto[] = regions) {
  return render(<RegionsView regions={list} t={en} locale="en" />);
}

function posted(): Record<string, string> {
  const form = document.querySelector("dialog form, [role='dialog'] form");
  if (form === null) throw new Error("no dialog form");
  return Object.fromEntries(
    [...new FormData(form as HTMLFormElement).entries()].map(([name, value]) => [
      name,
      String(value),
    ]),
  );
}

describe("RegionsView (Plan 3C)", () => {
  it("explains what to do when no tax is collected anywhere", () => {
    renderView([]);

    expect(screen.getByText(t.emptyState)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.addRegion })).toBeInTheDocument();
  });

  it("lists each country with its rate and how many province rates it has", () => {
    renderView();

    const rows = screen.getAllByRole("row").slice(1);
    const cells = rows.map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    );
    expect(cells[0]?.slice(0, 3)).toEqual(["Egypt", "14%", t.overridesCount.replace("{n}", "2")]);
    expect(cells[1]?.slice(0, 3)).toEqual(["Saudi Arabia", "15%", t.noOverrides]);
  });

  it("opens an empty dialog to add a region", () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: t.addRegion }));

    expect(screen.getByRole("dialog")).toHaveTextContent(t.addRegion);
    expect(posted()).toMatchObject({ country: "", rate: "", overrides: "[]" });
  });

  it("offers only countries that have no region yet", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: t.addRegion }));

    const select = screen.getByLabelText(t.country) as HTMLSelectElement;
    const values = [...select.options].map((option) => option.value);
    expect(values).toContain("AE");
    expect(values).not.toContain("EG");
    expect(values).not.toContain("SA");
  });

  it("posts the chosen country and rate", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: t.addRegion }));

    fireEvent.change(screen.getByLabelText(t.country), { target: { value: "AE" } });
    fireEvent.change(screen.getByLabelText(t.rateLabel), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: t.save }));

    await vi.waitFor(() => expect(actions.saveRegionAction).toHaveBeenCalledTimes(1));
    const data = actions.saveRegionAction.mock.calls[0]?.[1];
    expect(data.get("country")).toBe("AE");
    expect(data.get("rate")).toBe("5");
  });

  it("edits a region with its rate and province rates, the country fixed", () => {
    renderView();
    const egypt = screen.getAllByRole("row")[1]!;

    fireEvent.click(within(egypt).getByRole("button", { name: t.edit }));

    expect(screen.getByRole("dialog")).toHaveTextContent(t.editRegion);
    expect(screen.queryByLabelText(t.country)).not.toBeInTheDocument();
    expect(posted()).toMatchObject({ country: "EG", rate: "14" });
    expect(JSON.parse(posted()["overrides"] ?? "[]")).toEqual([
      { code: "EG-C", rate: "10" },
      { code: "EG-GZ", rate: "10" },
    ]);
  });

  it("adds, changes and removes a province rate for a country with provinces", () => {
    renderView();
    fireEvent.click(within(screen.getAllByRole("row")[1]!).getByRole("button", { name: t.edit }));

    fireEvent.click(screen.getByRole("button", { name: t.addOverride }));
    const selects = screen.getAllByLabelText(t.province) as HTMLSelectElement[];
    const added = selects[selects.length - 1]!;
    fireEvent.change(added, { target: { value: "EG-ALX" } });
    const rates = screen.getAllByLabelText(t.provinceRate);
    fireEvent.change(rates[rates.length - 1]!, { target: { value: "5" } });

    expect(JSON.parse(posted()["overrides"] ?? "[]")).toContainEqual({ code: "EG-ALX", rate: "5" });

    fireEvent.click(screen.getAllByRole("button", { name: t.removeOverride })[0]!);
    expect(JSON.parse(posted()["overrides"] ?? "[]")).not.toContainEqual({
      code: "EG-C",
      rate: "10",
    });
  });

  it("offers no province rates for a country without province data", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: t.addRegion }));

    fireEvent.change(screen.getByLabelText(t.country), { target: { value: "FR" } });

    expect(screen.queryByRole("button", { name: t.addOverride })).not.toBeInTheDocument();
  });

  it("asks before removing a region, naming the country, and removes only when confirmed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderView();
    const egypt = screen.getAllByRole("row")[1]!;

    fireEvent.click(within(egypt).getByRole("button", { name: t.deleteRegion }));
    expect(confirm).toHaveBeenCalledWith(t.confirmDeleteRegion.replace("{country}", "Egypt"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(actions.deleteRegionAction).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(within(egypt).getByRole("button", { name: t.deleteRegion }));
    await vi.waitFor(() => expect(actions.deleteRegionAction).toHaveBeenCalledTimes(1));
    expect(actions.deleteRegionAction.mock.calls[0]?.[1].get("country")).toBe("EG");
  });

  it("shows the server's message against the rate", async () => {
    actions.saveRegionAction.mockResolvedValue({
      status: "error",
      message: "Invalid",
      fieldErrors: { rate: "Enter a valid rate" },
    });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: t.addRegion }));
    fireEvent.click(screen.getByRole("button", { name: t.save }));

    expect(
      await screen.findByText("Enter a valid rate", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});
