import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { StoreSettingsDto } from "@/lib/api/store-settings";
import type { FormState } from "@/lib/api/mutation";
import { StoreSettingsForm } from "./store-settings-form";

const saveStoreSettingsAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
vi.mock("@/app/settings/general/actions", () => ({
  saveStoreSettingsAction: (previous: FormState, formData: FormData) =>
    saveStoreSettingsAction(previous, formData),
}));

beforeEach(() => {
  saveStoreSettingsAction.mockReset().mockResolvedValue({ status: "success" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const settings: StoreSettingsDto = {
  storeName: "Lumo",
  contactEmail: "hello@lumo.test",
  currency: "EGP",
  timezone: "Africa/Cairo",
  weightUnit: "kg",
};

const t = en.generalSettings;

function renderForm() {
  return render(<StoreSettingsForm settings={settings} t={en} locale="en" />);
}

const save = () => screen.getByRole("button", { name: t.save });

describe("StoreSettingsForm (Plan 3C)", () => {
  it("shows the saved values", () => {
    renderForm();

    expect(screen.getByLabelText(t.storeName)).toHaveValue("Lumo");
    expect(screen.getByLabelText(t.contactEmail)).toHaveValue("hello@lumo.test");
    expect(screen.getByLabelText(t.currency)).toHaveValue("EGP");
    expect(screen.getByLabelText(t.timezone)).toHaveValue("Africa/Cairo");
    expect(screen.getByLabelText(t.weightUnit)).toHaveValue("kg");
  });

  it("offers the currencies by code and name", () => {
    renderForm();

    const select = screen.getByLabelText(t.currency) as HTMLSelectElement;
    const egp = [...select.options].find((option) => option.value === "EGP");
    expect(egp?.textContent).toContain("EGP");
    expect(egp?.textContent).toMatch(/Egyptian Pound/i);
    expect([...select.options].some((option) => option.value === "XXX")).toBe(false);
  });

  it("keeps Save off until a field changes, and off again when the change is undone", () => {
    renderForm();
    expect(save()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(t.storeName), { target: { value: "Lumo Store" } });
    expect(save()).toBeEnabled();

    fireEvent.change(screen.getByLabelText(t.storeName), { target: { value: "Lumo" } });
    expect(save()).toBeDisabled();
  });

  it("submits every field through the action", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(t.storeName), { target: { value: "Lumo Store" } });

    fireEvent.click(save());

    await vi.waitFor(() => expect(saveStoreSettingsAction).toHaveBeenCalledTimes(1));
    const formData = saveStoreSettingsAction.mock.calls[0]?.[1];
    expect(Object.fromEntries(formData?.entries() ?? [])).toEqual({
      storeName: "Lumo Store",
      contactEmail: "hello@lumo.test",
      currency: "EGP",
      timezone: "Africa/Cairo",
      weightUnit: "kg",
    });
  });

  it("does not ask for confirmation when the currency is unchanged", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderForm();
    fireEvent.change(screen.getByLabelText(t.storeName), { target: { value: "Lumo Store" } });

    fireEvent.click(save());

    await vi.waitFor(() => expect(saveStoreSettingsAction).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks before changing the currency, naming the new code, and saves when confirmed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderForm();
    fireEvent.change(screen.getByLabelText(t.currency), { target: { value: "SAR" } });

    fireEvent.click(save());

    expect(confirm).toHaveBeenCalledWith(t.confirmBody.replace("{code}", "SAR"));
    await vi.waitFor(() => expect(saveStoreSettingsAction).toHaveBeenCalledTimes(1));
    expect(saveStoreSettingsAction.mock.calls[0]?.[1].get("currency")).toBe("SAR");
  });

  it("saves nothing when the merchant declines the currency change", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderForm();
    fireEvent.change(screen.getByLabelText(t.currency), { target: { value: "SAR" } });

    fireEvent.click(save());

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saveStoreSettingsAction).not.toHaveBeenCalled();
  });

  it("shows the server's message and the field it names", async () => {
    saveStoreSettingsAction.mockResolvedValue({
      status: "error",
      message: "Could not save",
      fieldErrors: { contactEmail: "must be a valid email address" },
    });
    renderForm();
    fireEvent.change(screen.getByLabelText(t.contactEmail), { target: { value: "nope" } });

    fireEvent.click(save());

    expect(await screen.findByText("Could not save")).toBeInTheDocument();
    expect(screen.getByText("must be a valid email address")).toBeInTheDocument();
  });
});
