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

function renderDialog(
  zoneBeingEdited: ZoneDto | null = null,
  zones: ZoneDto[] = [],
  homeCountry: "EG" | "SA" | "AE" = "AE",
) {
  return render(
    <Dialog open>
      <ZoneDialogContent
        zone={zoneBeingEdited}
        zones={zones}
        homeCountry={homeCountry}
        currency="EGP"
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

function ratesField(): unknown {
  const input = document.querySelector<HTMLInputElement>('input[name="rates"]');
  return JSON.parse(input?.value ?? "null");
}

const chip = (name: string) => screen.getByRole("button", { name });
const cairoGizaChip = t.chipCairoGiza;
const greaterCairoChip = t.chipGreaterCairo;
const allRemainingChip = t.chipAllRemaining.replace("{noun}", t.nounEG);

describe("ZoneDialogContent — the home country (Plan 3E)", () => {
  it("lists the store's own country first, with its governorates already open", () => {
    renderDialog(null, [], "EG");

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[1]).toHaveAccessibleName(/^Egypt/);
    expect(screen.getByRole("checkbox", { name: "Cairo" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Alexandria" })).toBeInTheDocument();
  });

  it("still lets the merchant close it and search", () => {
    renderDialog(null, [], "EG");

    fireEvent.click(
      screen.getByRole("button", { name: t.hideProvinces.replace("{noun}", t.nounEG) }),
    );
    expect(screen.queryByRole("checkbox", { name: "Cairo" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(t.searchCountries), { target: { value: "saudi" } });
    expect(screen.getByRole("checkbox", { name: /Saudi Arabia/ })).toBeInTheDocument();
  });
});

describe("ZoneDialogContent — province shortcuts (Plan 3E)", () => {
  it("offers three shortcuts for Egypt and one for Saudi Arabia", () => {
    const { unmount } = renderDialog(null, [], "EG");
    expect(chip(cairoGizaChip)).toBeInTheDocument();
    expect(chip(greaterCairoChip)).toBeInTheDocument();
    expect(chip(allRemainingChip)).toBeInTheDocument();
    unmount();

    renderDialog(null, [], "SA");
    expect(screen.queryByRole("button", { name: cairoGizaChip })).not.toBeInTheDocument();
    expect(chip(t.chipAllRemaining.replace("{noun}", t.nounSA))).toBeInTheDocument();
  });

  it("'Cairo and Giza' selects those two governorates", () => {
    renderDialog(null, [], "EG");

    fireEvent.click(chip(cairoGizaChip));

    expect(countriesField()).toEqual([{ code: "EG", provinces: ["EG-C", "EG-GZ"] }]);
  });

  it("'Greater Cairo' selects Cairo, Giza and Qalyubia", () => {
    renderDialog(null, [], "EG");

    fireEvent.click(chip(greaterCairoChip));

    expect(countriesField()).toEqual([{ code: "EG", provinces: ["EG-C", "EG-GZ", "EG-KB"] }]);
  });

  it("'All remaining' selects every governorate no other zone holds", () => {
    const cairo = zone("z1", "Cairo", [{ code: "EG", provinces: ["EG-C", "EG-GZ"] }]);
    renderDialog(null, [cairo], "EG");

    fireEvent.click(chip(allRemainingChip));

    const [egypt] = countriesField() as { code: string; provinces: string[] }[];
    expect(egypt?.code).toBe("EG");
    expect(egypt?.provinces).toHaveLength(25);
    expect(egypt?.provinces).not.toContain("EG-C");
    expect(egypt?.provinces).not.toContain("EG-GZ");
  });

  it("skips the governorates another zone holds", () => {
    const cairo = zone("z1", "Cairo", [{ code: "EG", provinces: ["EG-C"] }]);
    renderDialog(null, [cairo], "EG");

    fireEvent.click(chip(greaterCairoChip));

    expect(countriesField()).toEqual([{ code: "EG", provinces: ["EG-GZ", "EG-KB"] }]);
  });

  it("is disabled when every governorate it would pick is taken", () => {
    const cairoGiza = zone("z1", "Cairo", [{ code: "EG", provinces: ["EG-C", "EG-GZ"] }]);
    renderDialog(null, [cairoGiza], "EG");

    expect(chip(cairoGizaChip)).toBeDisabled();
    expect(chip(greaterCairoChip)).toBeEnabled();
  });

  it("is disabled once the selection is already exactly what it picks", () => {
    renderDialog(null, [], "EG");

    fireEvent.click(chip(cairoGizaChip));

    expect(chip(cairoGizaChip)).toBeDisabled();
    expect(chip(greaterCairoChip)).toBeEnabled();
  });

  it("is a plain button that never submits the form", () => {
    renderDialog(null, [], "EG");

    expect(chip(cairoGizaChip)).toHaveAttribute("type", "button");
  });
});

describe("ZoneDialogContent — the suggested name (Plan 3E)", () => {
  it("follows the selection until the merchant types", () => {
    renderDialog(null, [], "EG");

    fireEvent.click(chip(cairoGizaChip));
    expect(screen.getByLabelText(t.zoneName)).toHaveValue("Cairo and Giza");

    fireEvent.click(chip(greaterCairoChip));
    expect(screen.getByLabelText(t.zoneName)).toHaveValue("Cairo, Giza and Qalyubia");
  });

  it("stops following once the merchant has typed a name", () => {
    renderDialog(null, [], "EG");
    fireEvent.change(screen.getByLabelText(t.zoneName), { target: { value: "My zone" } });

    fireEvent.click(chip(cairoGizaChip));

    expect(screen.getByLabelText(t.zoneName)).toHaveValue("My zone");
  });

  it("calls the governorates the other zones leave 'Rest of Egypt'", () => {
    const cairo = zone("z1", "Cairo", [{ code: "EG", provinces: ["EG-C", "EG-GZ"] }]);
    renderDialog(null, [cairo], "EG");

    fireEvent.click(chip(allRemainingChip));

    expect(screen.getByLabelText(t.zoneName)).toHaveValue("Rest of Egypt");
  });

  it("never renames a zone that is being edited", () => {
    const mine = zone("z1", "Delivery", [{ code: "EG", provinces: ["EG-C"] }]);
    renderDialog(mine, [mine], "EG");

    fireEvent.click(chip(greaterCairoChip));

    expect(screen.getByLabelText(t.zoneName)).toHaveValue("Delivery");
  });
});

describe("ZoneDialogContent — the first rate (Plan 3E)", () => {
  it("posts the Standard preset as the rate once a price is typed", () => {
    renderDialog(null, [], "EG");
    fireEvent.change(screen.getByLabelText(t.price), { target: { value: "50" } });

    expect(ratesField()).toEqual([
      { name: "Standard", description: "2–4 business days", price: "50" },
    ]);
  });

  it("posts no rate while the price is empty, so a zone can still be made without one", () => {
    renderDialog(null, [], "EG");

    expect(ratesField()).toEqual([]);
  });

  it("posts the Express preset's name and transit time", () => {
    renderDialog(null, [], "EG");
    fireEvent.change(screen.getByLabelText(t.ratePresetLabel), { target: { value: "express" } });
    fireEvent.change(screen.getByLabelText(t.price), { target: { value: "80" } });

    expect(ratesField()).toEqual([
      { name: "Express", description: "1–2 business days", price: "80" },
    ]);
  });

  it("posts two rates with the conditions when free shipping over an amount is on", () => {
    renderDialog(null, [], "EG");
    fireEvent.change(screen.getByLabelText(t.price), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("switch", { name: t.freeOverToggle }));
    fireEvent.change(screen.getByLabelText(t.freeOverAmount), { target: { value: "1000" } });

    expect(ratesField()).toEqual([
      { name: "Standard", description: "2–4 business days", price: "50", max: "1000" },
      { name: "Free shipping", description: "2–4 business days", price: "0", min: "1000" },
    ]);
  });

  it("warns for a name that is only a price, and not for words", () => {
    renderDialog(null, [], "EG");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(t.rateName), { target: { value: "50" } });
    expect(screen.getByRole("status")).toHaveTextContent(t.rateNameLooksLikePrice);

    fireEvent.change(screen.getByLabelText(t.rateName), { target: { value: "Standard" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is not shown when editing, where rates are edited on the zone card", () => {
    const mine = zone("z1", "Delivery", [{ code: "EG", provinces: ["EG-C"] }]);
    renderDialog(mine, [mine], "EG");

    expect(screen.queryByLabelText(t.rateName)).not.toBeInTheDocument();
    expect(document.querySelector('input[name="rates"]')).toBeNull();
  });

  it("submits the rates JSON through the action", async () => {
    renderDialog(null, [], "EG");
    fireEvent.click(chip(cairoGizaChip));
    fireEvent.change(screen.getByLabelText(t.price), { target: { value: "50" } });

    fireEvent.click(screen.getByRole("button", { name: t.save }));

    await vi.waitFor(() => expect(saveZoneAction).toHaveBeenCalledTimes(1));
    const data = saveZoneAction.mock.calls[0]?.[1];
    expect(data?.get("name")).toBe("Cairo and Giza");
    expect(JSON.parse(String(data?.get("rates")))).toEqual([
      { name: "Standard", description: "2–4 business days", price: "50" },
    ]);
  });

  it("shows a server error under the price", async () => {
    saveZoneAction.mockResolvedValue({
      status: "error",
      message: "Invalid",
      fieldErrors: { ratePrice: "Enter a valid price" },
    });
    renderDialog(null, [], "EG");
    fireEvent.click(screen.getByRole("button", { name: t.save }));

    expect(
      await screen.findByText("Enter a valid price", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});
