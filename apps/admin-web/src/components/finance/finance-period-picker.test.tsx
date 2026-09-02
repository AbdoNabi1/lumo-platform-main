import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { FinancePeriodPicker } from "./finance-period-picker";

const push = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/finance",
  useSearchParams: () => currentSearchParams,
}));

beforeEach(() => {
  push.mockClear();
  currentSearchParams = new URLSearchParams();
});

afterEach(cleanup);

describe("FinancePeriodPicker", () => {
  it("initializes each field from the URL when present, ignoring the defaults", () => {
    currentSearchParams = new URLSearchParams({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      currency: "EUR",
    });

    render(
      <FinancePeriodPicker
        t={en}
        defaultStartDate="2026-01-01"
        defaultEndDate="2026-01-31"
        defaultCurrency="USD"
      />,
    );

    expect(screen.getByLabelText(en.financePage.periodStartLabel)).toHaveValue("2026-02-01");
    expect(screen.getByLabelText(en.financePage.periodEndLabel)).toHaveValue("2026-02-28");
    expect(screen.getByLabelText(en.financePage.currencyLabel)).toHaveValue("EUR");
  });

  it("falls back to the provided defaults when the URL has no period yet", () => {
    render(
      <FinancePeriodPicker
        t={en}
        defaultStartDate="2026-01-01"
        defaultEndDate="2026-01-31"
        defaultCurrency="USD"
      />,
    );

    expect(screen.getByLabelText(en.financePage.periodStartLabel)).toHaveValue("2026-01-01");
    expect(screen.getByLabelText(en.financePage.currencyLabel)).toHaveValue("USD");
  });

  it("pushes the trimmed, uppercased currency and both dates on submit", () => {
    render(
      <FinancePeriodPicker
        t={en}
        defaultStartDate="2026-01-01"
        defaultEndDate="2026-01-31"
        defaultCurrency="USD"
      />,
    );

    fireEvent.change(screen.getByLabelText(en.financePage.periodStartLabel), {
      target: { value: "2026-03-01" },
    });
    fireEvent.change(screen.getByLabelText(en.financePage.periodEndLabel), {
      target: { value: "2026-03-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: en.financePage.apply }));

    expect(push).toHaveBeenCalledWith("/finance?startDate=2026-03-01&endDate=2026-03-31&currency=USD");
  });

  it("uppercases lowercase currency input as the user types", () => {
    render(
      <FinancePeriodPicker
        t={en}
        defaultStartDate="2026-01-01"
        defaultEndDate="2026-01-31"
        defaultCurrency="USD"
      />,
    );

    fireEvent.change(screen.getByLabelText(en.financePage.currencyLabel), {
      target: { value: "eur" },
    });

    expect(screen.getByLabelText(en.financePage.currencyLabel)).toHaveValue("EUR");
  });
});
