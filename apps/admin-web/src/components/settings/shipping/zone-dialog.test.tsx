import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Dialog } from "@platform/ui";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import type { ZoneDto } from "@/lib/shipping/zones";
import { ZoneDialogContent } from "./zone-dialog";

const saveZoneAction = vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
vi.mock("@/app/settings/shipping/actions", () => ({
  saveZoneAction: (previous: FormState, formData: FormData) => saveZoneAction(previous, formData),
}));

beforeEach(() => {
  saveZoneAction.mockReset().mockResolvedValue({ status: "success" });
});

const t = en.shippingSettings;

function zone(id: string, name: string, countries: ZoneDto["countries"]): ZoneDto {
  return { id, name, profile: "general", countries, rates: [] };
}

function renderDialog(zoneBeingEdited: ZoneDto | null = null, zones: ZoneDto[] = []) {
  return render(
    <Dialog open>
      <ZoneDialogContent
        zone={zoneBeingEdited}
        zones={zones}
        onClose={() => undefined}
        t={en}
        locale="en"
      />
    </Dialog>,
  );
}

function countriesField(): unknown {
  const input = document.querySelector<HTMLInputElement>('input[name="countries"]');
  return JSON.parse(input?.value ?? "null");
}

function countryBox(name: string): HTMLInputElement {
  return screen.getByRole("checkbox", { name: new RegExp(`^${name}`) });
}

describe("ZoneDialogContent (Plan 3C)", () => {
  it("starts empty when creating, and names the dialog", () => {
    renderDialog();

    expect(screen.getByRole("heading", { name: t.createZone })).toBeInTheDocument();
    expect(screen.getByLabelText(t.zoneName)).toHaveValue("");
    expect(countriesField()).toEqual([]);
  });

  it("ticking a country makes it the whole country", () => {
    renderDialog();

    fireEvent.click(countryBox("Saudi Arabia"));

    expect(countriesField()).toEqual([{ code: "SA", provinces: null }]);
  });

  it("finds a country by name", () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText(t.searchCountries), { target: { value: "saudi" } });

    expect(screen.getByRole("checkbox", { name: /Saudi Arabia/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /^Egypt/ })).not.toBeInTheDocument();
  });

  it("says so when no country matches the search", () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText(t.searchCountries), { target: { value: "zzzz" } });

    expect(screen.getByText(t.noCountryMatches)).toBeInTheDocument();
  });

  it("expands Egypt to its 27 governorates, and ticking two makes a partial zone", () => {
    renderDialog();

    fireEvent.click(
      screen.getByRole("button", { name: t.showProvinces.replace("{noun}", t.nounEG) }),
    );
    expect(screen.getAllByRole("checkbox", { name: /^(Cairo|Giza)$/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox", { name: "Cairo" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Giza" }));

    expect(countriesField()).toEqual([{ code: "EG", provinces: ["EG-C", "EG-GZ"] }]);
    expect(countryBox("Egypt").indeterminate).toBe(true);
  });

  it("ticking Egypt ticks every governorate and posts the whole country", () => {
    renderDialog();

    fireEvent.click(countryBox("Egypt"));
    fireEvent.click(
      screen.getByRole("button", { name: t.showProvinces.replace("{noun}", t.nounEG) }),
    );

    expect(countriesField()).toEqual([{ code: "EG", provinces: null }]);
    expect(screen.getByRole("checkbox", { name: "Cairo" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Alexandria" })).toBeChecked();
  });

  it("rest of world stands alone: ticking it clears the others", () => {
    renderDialog();
    fireEvent.click(countryBox("Saudi Arabia"));

    fireEvent.click(screen.getByRole("checkbox", { name: t.restOfWorld }));

    expect(countriesField()).toEqual([{ code: "*", provinces: null }]);
    expect(countryBox("Saudi Arabia")).not.toBeChecked();
  });

  it("shows a country another zone holds as disabled, naming that zone", () => {
    renderDialog(null, [zone("z1", "Saudi zone", [{ code: "SA", provinces: null }])]);

    expect(countryBox("Saudi Arabia")).toBeDisabled();
    expect(screen.getByText(t.inZone.replace("{zone}", "Saudi zone"))).toBeInTheDocument();
  });

  it("disables a governorate another zone holds, but not the others", () => {
    renderDialog(null, [zone("z1", "Cairo zone", [{ code: "EG", provinces: ["EG-C"] }])]);

    fireEvent.click(
      screen.getByRole("button", { name: t.showProvinces.replace("{noun}", t.nounEG) }),
    );

    expect(screen.getByRole("checkbox", { name: /^Cairo/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Giza" })).toBeEnabled();
    expect(screen.getByText(t.inZone.replace("{zone}", "Cairo zone"))).toBeInTheDocument();
  });

  it("does not disable the countries of the zone being edited", () => {
    const mine = zone("z1", "Saudi zone", [{ code: "SA", provinces: null }]);
    renderDialog(mine, [mine]);

    expect(screen.getByRole("heading", { name: t.editZone })).toBeInTheDocument();
    expect(screen.getByLabelText(t.zoneName)).toHaveValue("Saudi zone");
    expect(countryBox("Saudi Arabia")).toBeEnabled();
    expect(countryBox("Saudi Arabia")).toBeChecked();
    expect((document.querySelector('input[name="zoneId"]') as HTMLInputElement).value).toBe("z1");
  });

  it("submits the name and the countries through the action", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(t.zoneName), { target: { value: "Gulf" } });
    fireEvent.click(countryBox("Saudi Arabia"));

    fireEvent.click(screen.getByRole("button", { name: t.save }));

    await vi.waitFor(() => expect(saveZoneAction).toHaveBeenCalledTimes(1));
    const data = saveZoneAction.mock.calls[0]?.[1];
    expect(data?.get("name")).toBe("Gulf");
    expect(JSON.parse(String(data?.get("countries")))).toEqual([{ code: "SA", provinces: null }]);
    expect(data?.has("zoneId")).toBe(false);
  });

  it("shows the server's message, for example the zone that already holds a country", async () => {
    saveZoneAction.mockResolvedValue({
      status: "error",
      message: "Invalid shipping zone",
      fieldErrors: { countries: 'EG is already in zone "Cairo and Giza"' },
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: t.save }));

    const dialog = await screen.findByRole("dialog", {}, { timeout: 5000 });
    expect(
      await within(dialog).findByText(/Cairo and Giza/, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});
