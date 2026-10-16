import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import { QuickSetup } from "./quick-setup";

const quickSetupAction = vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
vi.mock("@/app/settings/shipping/actions", () => ({
  quickSetupAction: (previous: FormState, formData: FormData) =>
    quickSetupAction(previous, formData),
}));

beforeEach(() => {
  quickSetupAction.mockReset().mockResolvedValue({ status: "success" });
});

const t = en.shippingSettings;

function renderCard(homeCountry: "EG" | "SA" | "AE" = "EG", currency = "EGP") {
  return render(<QuickSetup homeCountry={homeCountry} currency={currency} t={en} locale="en" />);
}

function posted(): Record<string, string> {
  const form = document.querySelector("form");
  if (form === null) throw new Error("no form");
  return Object.fromEntries(
    [...new FormData(form).entries()].map(([name, value]) => [name, String(value)]),
  );
}

const save = () => screen.getByRole("button", { name: t.quickSetupSave });

describe("QuickSetup (Plan 3E)", () => {
  it("opens on the store's own country", () => {
    renderCard("SA", "SAR");

    expect(screen.getByLabelText(t.quickSetupCountry)).toHaveValue("SA");
  });

  it("asks for the Cairo and Giza price and the other governorates' price for Egypt", () => {
    renderCard();

    expect(screen.getByLabelText(t.quickSetupCityPrice)).toBeInTheDocument();
    expect(screen.getByLabelText(t.quickSetupRestPrice)).toBeInTheDocument();
    expect(screen.queryByLabelText(t.quickSetupWholePrice)).not.toBeInTheDocument();
    expect(screen.getByLabelText(t.quickSetupCityPrice)).toHaveAttribute("placeholder", "50");
    expect(screen.getByLabelText(t.quickSetupRestPrice)).toHaveAttribute("placeholder", "75");
  });

  it("asks for a single price for Saudi Arabia", () => {
    renderCard("SA", "SAR");

    expect(screen.getByLabelText(t.quickSetupWholePrice)).toBeInTheDocument();
    expect(screen.queryByLabelText(t.quickSetupRestPrice)).not.toBeInTheDocument();
  });

  it("switches the fields when the country changes", () => {
    renderCard();

    fireEvent.change(screen.getByLabelText(t.quickSetupCountry), { target: { value: "AE" } });

    expect(screen.getByLabelText(t.quickSetupWholePrice)).toBeInTheDocument();
    expect(screen.queryByLabelText(t.quickSetupCityPrice)).not.toBeInTheDocument();
  });

  it("shows the currency code the prices are in", () => {
    renderCard();

    expect(screen.getByText(t.quickSetupCurrency.replace("{currency}", "EGP"))).toBeInTheDocument();
  });

  it("keeps Save disabled until the required prices are filled", () => {
    renderCard();
    expect(save()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(t.quickSetupCityPrice), { target: { value: "50" } });
    expect(save()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(t.quickSetupRestPrice), { target: { value: "75" } });
    expect(save()).toBeEnabled();
  });

  it("needs only one price for Saudi Arabia, and the free-shipping amount is optional", () => {
    renderCard("SA", "SAR");

    fireEvent.change(screen.getByLabelText(t.quickSetupWholePrice), { target: { value: "30" } });

    expect(save()).toBeEnabled();
  });

  it("posts the country, the prices and the free-shipping amount", () => {
    renderCard();
    fireEvent.change(screen.getByLabelText(t.quickSetupCityPrice), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText(t.quickSetupRestPrice), { target: { value: "75" } });
    fireEvent.change(screen.getByLabelText(t.quickSetupFreeOver), { target: { value: "1000" } });

    expect(posted()).toEqual({ country: "EG", cityPrice: "50", restPrice: "75", freeOver: "1000" });
  });

  it("shows the message the action returns", async () => {
    quickSetupAction.mockResolvedValue({ status: "error", message: "Half saved", fieldErrors: {} });
    renderCard();
    fireEvent.change(screen.getByLabelText(t.quickSetupCityPrice), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText(t.quickSetupRestPrice), { target: { value: "75" } });

    fireEvent.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent("Half saved");
  });

  it("speaks Arabic", () => {
    render(<QuickSetup homeCountry="EG" currency="EGP" t={ar} locale="ar" />);

    expect(screen.getByText(ar.shippingSettings.quickSetupTitle)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: ar.shippingSettings.quickSetupSave }),
    ).toBeInTheDocument();
  });
});
