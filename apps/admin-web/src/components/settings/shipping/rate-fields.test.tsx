import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import type { RateDto } from "@/lib/shipping/zones";
import { RateFields, initialRateFields } from "./rate-fields";

const t = en.shippingSettings;

const owners50: RateDto = {
  id: "r-1",
  name: "50",
  priceMinor: 5000,
  condition: { type: "none" },
  description: null,
};

function Harness({ rate = null, locale = "en" }: { rate?: RateDto | null; locale?: "en" | "ar" }) {
  const dictionary = locale === "ar" ? ar : en;
  const [value, setValue] = useState(initialRateFields(rate, "EGP", locale));
  return (
    <RateFields
      value={value}
      onChange={setValue}
      currency="EGP"
      locale={locale}
      t={dictionary}
      errors={{}}
    />
  );
}

describe("initialRateFields", () => {
  it("is the Standard preset for a new rate", () => {
    expect(initialRateFields(null, "EGP", "en")).toEqual({
      preset: "standard",
      name: "Standard",
      description: "2–4 business days",
      price: "",
    });
  });

  it("keeps an existing rate's values as Custom", () => {
    expect(initialRateFields(owners50, "EGP", "en")).toEqual({
      preset: "custom",
      name: "50",
      description: "",
      price: "50.00",
    });
  });
});

describe("RateFields (Plan 3E)", () => {
  it("starts on Standard with its name and transit time", () => {
    render(<Harness />);

    expect(screen.getByLabelText(t.ratePresetLabel)).toHaveValue("standard");
    expect(screen.getByLabelText(t.rateName)).toHaveValue("Standard");
    expect(screen.getByLabelText(t.description)).toHaveValue("2–4 business days");
  });

  it("fills the name and the description when another preset is picked", () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText(t.ratePresetLabel), { target: { value: "express" } });

    expect(screen.getByLabelText(t.rateName)).toHaveValue("Express");
    expect(screen.getByLabelText(t.description)).toHaveValue("1–2 business days");
  });

  it("fills in Arabic when the admin works in Arabic", () => {
    render(<Harness locale="ar" />);

    fireEvent.change(screen.getByLabelText(ar.shippingSettings.ratePresetLabel), {
      target: { value: "express" },
    });

    expect(screen.getByLabelText(ar.shippingSettings.rateName)).toHaveValue("شحن سريع");
    expect(screen.getByLabelText(ar.shippingSettings.description)).toHaveValue(
      "من يوم لـ يومين عمل",
    );
  });

  it("empties the fields on Custom", () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText(t.ratePresetLabel), { target: { value: "custom" } });

    expect(screen.getByLabelText(t.rateName)).toHaveValue("");
    expect(screen.getByLabelText(t.description)).toHaveValue("");
  });

  it("keeps what the merchant typed in the price when the preset changes", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(t.price), { target: { value: "65" } });

    fireEvent.change(screen.getByLabelText(t.ratePresetLabel), { target: { value: "express" } });

    expect(screen.getByLabelText(t.price)).toHaveValue("65");
  });

  it("sets the price to zero with the Free shortcut", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: t.free }));

    expect(screen.getByLabelText(t.price)).toHaveValue("0.00");
  });

  it("warns, without blocking, when the name is only a price", () => {
    render(<Harness rate={owners50} />);

    expect(screen.getByRole("status")).toHaveTextContent(t.rateNameLooksLikePrice);
    expect(screen.getByLabelText(t.rateName)).toHaveValue("50");
  });

  it("does not warn for a name made of words, and the warning follows typing", () => {
    render(<Harness />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(t.rateName), { target: { value: "50" } });
    expect(screen.getByRole("status")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(t.rateName), { target: { value: "Standard" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
