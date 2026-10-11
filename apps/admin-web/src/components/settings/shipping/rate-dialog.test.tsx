import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Dialog } from "@platform/ui";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import type { RateDto } from "@/lib/shipping/zones";
import { RateDialogContent } from "./rate-dialog";

const saveRateAction = vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
vi.mock("@/app/settings/shipping/actions", () => ({
  saveRateAction: (previous: FormState, formData: FormData) => saveRateAction(previous, formData),
}));

beforeEach(() => {
  saveRateAction.mockReset().mockResolvedValue({ status: "success" });
});

const t = en.shippingSettings;

function renderDialog(rate: RateDto | null = null, weightUnit: "kg" | "g" | "lb" | "oz" = "kg") {
  return render(
    <Dialog open>
      <RateDialogContent
        zoneId="z-1"
        rate={rate}
        currency="EGP"
        weightUnit={weightUnit}
        onClose={() => undefined}
        t={en}
        locale="en"
      />
    </Dialog>,
  );
}

function posted(): Record<string, string> {
  const form = document.querySelector("form");
  if (form === null) throw new Error("no form");
  return Object.fromEntries(
    [...new FormData(form).entries()].map(([name, value]) => [name, String(value)]),
  );
}

describe("RateDialogContent (Plan 3C)", () => {
  it("starts empty when adding a rate, with Shopify's hints", () => {
    renderDialog();

    expect(screen.getByRole("heading", { name: t.addRate })).toBeInTheDocument();
    expect(screen.getByLabelText(t.rateName)).toHaveValue("");
    expect(screen.getByText(t.rateNameHint)).toBeInTheDocument();
    expect(screen.getByText(t.descriptionHint)).toBeInTheDocument();
    expect(posted()).toMatchObject({ zoneId: "z-1", conditionType: "none" });
    expect(posted()["rateId"]).toBeUndefined();
  });

  it('sets the price to zero with the "Free" shortcut', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(t.price), { target: { value: "50" } });

    fireEvent.click(screen.getByRole("button", { name: t.free }));

    expect(posted()["price"]).toBe("0.00");
  });

  it("asks for a weight range in the store's unit when the condition is weight", () => {
    renderDialog(null, "lb");

    fireEvent.click(screen.getByRole("radio", { name: t.conditionWeight }));
    fireEvent.change(screen.getByLabelText(`${t.minimum} (${en.productEditor.pounds})`), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText(`${t.maximum} (${en.productEditor.pounds})`), {
      target: { value: "10" },
    });

    expect(posted()).toMatchObject({ conditionType: "weight", min: "0", max: "10" });
  });

  it("asks for an order price range in the store currency when the condition is order price", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("radio", { name: t.conditionPrice }));
    fireEvent.change(screen.getByLabelText(t.minimum), { target: { value: "1000" } });

    expect(posted()).toMatchObject({ conditionType: "orderPrice", min: "1000", max: "" });
  });

  it("hides the bounds again for no conditions", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: t.conditionWeight }));
    expect(screen.getByLabelText(new RegExp(`^${t.minimum}`))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: t.conditionNone }));

    expect(screen.queryByLabelText(new RegExp(`^${t.minimum}`))).not.toBeInTheDocument();
  });

  it("opens an existing rate with its values in the store's units", () => {
    renderDialog({
      id: "r-1",
      name: "Light",
      priceMinor: 5000,
      condition: { type: "weight", minGrams: 0, maxGrams: 5000 },
      description: "2–4 days",
    });

    expect(screen.getByRole("heading", { name: t.editRate })).toBeInTheDocument();
    expect(posted()).toMatchObject({
      rateId: "r-1",
      zoneId: "z-1",
      name: "Light",
      description: "2–4 days",
      price: "50.00",
      conditionType: "weight",
      min: "0",
      max: "5",
    });
  });

  it("submits through the action", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(t.rateName), { target: { value: "Standard" } });
    fireEvent.change(screen.getByLabelText(t.price), { target: { value: "50" } });

    fireEvent.click(screen.getByRole("button", { name: t.save }));

    await vi.waitFor(() => expect(saveRateAction).toHaveBeenCalledTimes(1));
    expect(saveRateAction.mock.calls[0]?.[1].get("name")).toBe("Standard");
    expect(saveRateAction.mock.calls[0]?.[1].get("price")).toBe("50");
  });

  it("shows the server's message against the field it names", async () => {
    saveRateAction.mockResolvedValue({
      status: "error",
      message: "Invalid",
      fieldErrors: { price: "Enter a valid price" },
    });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: t.save }));

    expect(
      await screen.findByText("Enter a valid price", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});
