import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { FinanceModelPicker } from "./finance-model-picker";

const push = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/finance/read-models",
  useSearchParams: () => currentSearchParams,
}));

beforeEach(() => {
  push.mockClear();
  currentSearchParams = new URLSearchParams();
});

afterEach(cleanup);

describe("FinanceModelPicker", () => {
  it("lists every FINANCE_READ_MODELS entry with its translated label", () => {
    render(<FinanceModelPicker t={en} selected="profit" />);

    expect(screen.getByRole("option", { name: en.financeReadModelsPage.models.profit })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: en.financeReadModelsPage.models.margin })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: en.financeReadModelsPage.models.financial_health }),
    ).toBeInTheDocument();
  });

  it("reflects the selected model", () => {
    render(<FinanceModelPicker t={en} selected="margin" />);
    expect(screen.getByLabelText(en.financeReadModelsPage.modelLabel)).toHaveValue("margin");
  });

  it("pushes the new model and drops the drill-in key on change", () => {
    currentSearchParams = new URLSearchParams({ model: "profit", key: "2026-07" });

    render(<FinanceModelPicker t={en} selected="profit" />);

    fireEvent.change(screen.getByLabelText(en.financeReadModelsPage.modelLabel), {
      target: { value: "margin" },
    });

    expect(push).toHaveBeenCalledWith("/finance/read-models?model=margin");
  });
});
