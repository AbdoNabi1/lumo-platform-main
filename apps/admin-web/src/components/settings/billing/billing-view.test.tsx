import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import type { MerchantBillingDto, MerchantInvoiceDto, MerchantPlanDto } from "@/lib/billing/model";
import { BillingView } from "./billing-view";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;
const changeMyPlanAction = vi.fn<Action>();
const payMyInvoiceAction = vi.fn<Action>();

vi.mock("@/app/settings/billing/actions", () => ({
  changeMyPlanAction: (previous: FormState, formData: FormData) =>
    changeMyPlanAction(previous, formData),
  payMyInvoiceAction: (previous: FormState, formData: FormData) =>
    payMyInvoiceAction(previous, formData),
}));

beforeEach(() => {
  changeMyPlanAction.mockReset().mockResolvedValue({ status: "success" });
  payMyInvoiceAction.mockReset().mockResolvedValue({ status: "success" });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = new Date("2026-10-17T10:00:00.000Z");

const starter: MerchantPlanDto = {
  key: "starter",
  name: "Starter",
  planVersionRef: "pv1",
  priceMinor: 29900,
  currency: "EGP",
  billingCycle: "monthly",
  trialDays: 14,
};
const yearly: MerchantPlanDto = {
  key: "yearly",
  name: "Yearly",
  planVersionRef: "pv2",
  priceMinor: 299000,
  currency: "EGP",
  billingCycle: "annual",
  trialDays: 0,
};

function invoice(overrides: Partial<MerchantInvoiceDto>): MerchantInvoiceDto {
  return {
    id: "inv1",
    status: "issued",
    totalMinor: 29900,
    currency: "EGP",
    createdAt: "2026-10-10T08:00:00.000Z",
    ...overrides,
  };
}

function billing(overrides: Partial<MerchantBillingDto>): MerchantBillingDto {
  return {
    plan: starter,
    status: "active",
    nextChargeAt: "2026-11-10T00:00:00.000Z",
    trialEndsAt: null,
    cardOnFile: true,
    invoices: [],
    ...overrides,
  };
}

const t = en.billingPage;

function view(b: MerchantBillingDto, plans: readonly MerchantPlanDto[] = [starter, yearly]) {
  return render(<BillingView billing={b} plans={plans} locale="en" now={NOW} t={en} />);
}

describe("BillingView plan card", () => {
  it("shows the trial with whole days left and the end date", () => {
    view(billing({ status: "trial", trialEndsAt: "2026-10-27T10:00:00.000Z", nextChargeAt: null }));

    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText(/EGP\s*299\.00\s*\/\s*month/)).toBeInTheDocument();
    expect(screen.getByText(/Free trial — 10 days left \(ends Oct 27, 2026\)/)).toBeInTheDocument();
  });

  it("reads 1 day left in the singular and a lapsed trial as ended", () => {
    view(billing({ status: "trial", trialEndsAt: "2026-10-18T09:00:00.000Z" }));
    expect(screen.getByText(/Free trial — 1 day left/)).toBeInTheDocument();
    cleanup();

    view(billing({ status: "trial", trialEndsAt: "2026-10-01T00:00:00.000Z" }));
    expect(screen.getByText(t.statusTrialEnded)).toBeInTheDocument();
  });

  it("shows the next charge date for an active plan, priced per year when annual", () => {
    view(billing({ plan: yearly, nextChargeAt: "2027-10-10T00:00:00.000Z" }));

    expect(screen.getByText(/EGP\s*2,990\.00\s*\/\s*year/)).toBeInTheDocument();
    expect(screen.getByText("Next charge on Oct 10, 2027")).toBeInTheDocument();
  });

  it.each(["grace", "suspended", "expired"])(
    "shows the overdue notice, in a destructive tone, when %s",
    (status) => {
      view(billing({ status }));

      const notice = screen.getByText(t.statusPastDue);
      expect(notice).toBeInTheDocument();
      expect(notice.className).toMatch(/destructive/);
    },
  );

  it("says there is no plan yet when there is no subscription", () => {
    view(billing({ plan: null, status: null, nextChargeAt: null, cardOnFile: false }));

    expect(screen.getByText(t.statusNone)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.changePlan })).toBeInTheDocument();
  });
});

describe("BillingView payment method card", () => {
  it("says the card is saved for renewals", () => {
    view(billing({ cardOnFile: true }));
    expect(screen.getByText(t.cardSaved)).toBeInTheDocument();
  });

  it("explains how the card gets saved when there is none", () => {
    view(billing({ cardOnFile: false }));
    expect(screen.getByText(t.noCard)).toBeInTheDocument();
  });
});

describe("BillingView bills table", () => {
  it("shows an empty state without invoices", () => {
    view(billing({}));
    expect(screen.getByText(t.billsEmpty)).toBeInTheDocument();
  });

  it("lists date, total and status, with Pay now only on an issued invoice", () => {
    view(
      billing({
        invoices: [
          invoice({ id: "inv-due", status: "issued" }),
          invoice({ id: "inv-paid", status: "paid", createdAt: "2026-09-10T08:00:00.000Z" }),
        ],
      }),
    );

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const due = rows[0]!;
    expect(within(due).getByText("Oct 10, 2026")).toBeInTheDocument();
    expect(within(due).getByText(/EGP\s*299\.00/)).toBeInTheDocument();
    expect(within(due).getByText(t.invoiceIssued)).toBeInTheDocument();
    expect(within(due).getByRole("button", { name: t.payNow })).toBeInTheDocument();

    const paid = rows[1]!;
    expect(within(paid).getByText(t.invoicePaid)).toBeInTheDocument();
    expect(within(paid).queryByRole("button", { name: t.payNow })).not.toBeInTheDocument();
  });

  it("posts the invoice id from Pay now and disables the button while submitting", async () => {
    let finish: (state: FormState) => void = () => undefined;
    payMyInvoiceAction.mockReturnValue(
      new Promise<FormState>((resolve) => {
        finish = resolve;
      }),
    );
    view(billing({ invoices: [invoice({ id: "inv-due" })] }));

    fireEvent.click(screen.getByRole("button", { name: t.payNow }));

    await waitFor(() => expect(payMyInvoiceAction).toHaveBeenCalledTimes(1));
    expect(payMyInvoiceAction.mock.calls[0]?.[1].get("invoiceId")).toBe("inv-due");
    await waitFor(() => expect(screen.getByRole("button", { name: t.paying })).toBeDisabled());

    finish({ status: "success" });
  });

  it("shows why paying failed", async () => {
    payMyInvoiceAction.mockResolvedValue({
      status: "error",
      message: t.errorInvoiceGone,
      fieldErrors: {},
    });
    view(billing({ invoices: [invoice({})] }));

    fireEvent.click(screen.getByRole("button", { name: t.payNow }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t.errorInvoiceGone);
    expect(screen.getByRole("button", { name: t.payNow })).toBeEnabled();
  });
});

describe("BillingView change plan", () => {
  it("lists the published plans with the current one marked", () => {
    view(billing({}));

    fireEvent.click(screen.getByRole("button", { name: t.changePlan }));

    expect(screen.getByRole("radio", { name: /Starter/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Yearly/ })).not.toBeChecked();
    expect(screen.getByText(t.currentPlan)).toBeInTheDocument();
  });

  it("submits the chosen plan key", async () => {
    view(billing({}));
    fireEvent.click(screen.getByRole("button", { name: t.changePlan }));

    fireEvent.click(screen.getByRole("radio", { name: /Yearly/ }));
    fireEvent.click(screen.getByRole("button", { name: t.confirmChange }));

    await waitFor(() => expect(changeMyPlanAction).toHaveBeenCalledTimes(1));
    expect(changeMyPlanAction.mock.calls[0]?.[1].get("planKey")).toBe("yearly");
    await waitFor(() =>
      expect(screen.queryByRole("radio", { name: /Yearly/ })).not.toBeInTheDocument(),
    );
  });

  it("does not offer to confirm the plan the shop is already on", () => {
    view(billing({}));
    fireEvent.click(screen.getByRole("button", { name: t.changePlan }));

    expect(screen.getByRole("button", { name: t.confirmChange })).toBeDisabled();
  });

  it("keeps the picker open and shows the error when the change fails", async () => {
    changeMyPlanAction.mockResolvedValue({
      status: "error",
      message: "That plan is not available.",
      fieldErrors: {},
    });
    view(billing({}));
    fireEvent.click(screen.getByRole("button", { name: t.changePlan }));
    fireEvent.click(screen.getByRole("radio", { name: /Yearly/ }));
    fireEvent.click(screen.getByRole("button", { name: t.confirmChange }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That plan is not available.");
    expect(screen.getByRole("radio", { name: /Yearly/ })).toBeInTheDocument();
  });

  it("says no plans are available when the list is empty", () => {
    view(billing({}), []);
    fireEvent.click(screen.getByRole("button", { name: t.changePlan }));

    expect(screen.getByText(t.noPlans)).toBeInTheDocument();
  });
});

describe("BillingView in Arabic", () => {
  it("renders the trial line, card note and bills with Arabic copy and digits", () => {
    render(
      <BillingView
        billing={billing({
          status: "trial",
          trialEndsAt: "2026-10-27T10:00:00.000Z",
          cardOnFile: false,
          invoices: [invoice({})],
        })}
        plans={[starter]}
        locale="ar"
        now={NOW}
        t={ar}
      />,
    );

    expect(screen.getByText(ar.billingPage.planCardTitle)).toBeInTheDocument();
    expect(screen.getByText(/فاضل (10|١٠) يوم/)).toBeInTheDocument();
    expect(screen.getByText(ar.billingPage.noCard)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.billingPage.payNow })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.billingPage.changePlan })).toBeInTheDocument();
    expect(screen.getByText(ar.billingPage.invoiceIssued)).toBeInTheDocument();
  });
});
