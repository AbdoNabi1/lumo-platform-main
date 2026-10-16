import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import { TaxFlagsForm } from "./tax-flags-form";

const saveTaxFlagsAction = vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
vi.mock("@/app/settings/taxes/actions", () => ({
  saveTaxFlagsAction: (previous: FormState, formData: FormData) =>
    saveTaxFlagsAction(previous, formData),
}));

beforeEach(() => {
  saveTaxFlagsAction.mockReset().mockResolvedValue({ status: "success" });
});

const t = en.taxSettings;

function renderForm(pricesIncludeTax = true, chargeTaxOnShipping = false) {
  return render(
    <TaxFlagsForm
      pricesIncludeTax={pricesIncludeTax}
      chargeTaxOnShipping={chargeTaxOnShipping}
      t={en}
    />,
  );
}

const save = () => screen.getByRole("button", { name: t.save });
const priceSwitch = () => screen.getByRole("switch", { name: t.pricesIncludeTax });
const shippingSwitch = () => screen.getByRole("switch", { name: t.chargeShipping });

describe("TaxFlagsForm (Plan 3C)", () => {
  it("shows both switches as saved, with Shopify's hints", () => {
    renderForm(true, false);

    expect(priceSwitch()).toBeChecked();
    expect(shippingSwitch()).not.toBeChecked();
    expect(screen.getByText(t.pricesIncludeTaxHint)).toBeInTheDocument();
    expect(screen.getByText(t.chargeShippingHint)).toBeInTheDocument();
  });

  it("keeps Save off until a switch changes, and off again when the change is undone", () => {
    renderForm();
    expect(save()).toBeDisabled();

    fireEvent.click(shippingSwitch());
    expect(save()).toBeEnabled();

    fireEvent.click(shippingSwitch());
    expect(save()).toBeDisabled();
  });

  it("posts each switch as on while on and nothing while off", async () => {
    renderForm(true, false);
    fireEvent.click(shippingSwitch());
    fireEvent.click(priceSwitch());

    fireEvent.click(save());

    await vi.waitFor(() => expect(saveTaxFlagsAction).toHaveBeenCalledTimes(1));
    const data = saveTaxFlagsAction.mock.calls[0]?.[1];
    expect(data?.get("chargeTaxOnShipping")).toBe("on");
    expect(data?.has("pricesIncludeTax")).toBe(false);
  });

  it("shows the server's message when the save fails", async () => {
    saveTaxFlagsAction.mockResolvedValue({
      status: "error",
      message: "Could not save",
      fieldErrors: {},
    });
    renderForm();
    fireEvent.click(shippingSwitch());

    fireEvent.click(save());

    expect(await screen.findByText("Could not save", {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
