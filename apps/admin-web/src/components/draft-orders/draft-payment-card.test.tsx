import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { DraftOrderDto } from "@/lib/api/draft-orders";
import { formFromDraft } from "@/lib/orders/draft-orders";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

const draftShippingRatesAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/draft-orders/actions", () => ({ draftShippingRatesAction }));

const { DraftPaymentCard } = await import("./draft-payment-card");

const p = en.draftOrders.editor.payment;

const DTO: DraftOrderDto = {
  id: "01920000-0000-7000-8000-00000000d003",
  draftNumber: "D3",
  status: "open",
  version: 2,
  currency: "EGP",
  createdAt: "2026-10-25T10:00:00.000Z",
  updatedAt: "2026-10-25T10:00:00.000Z",
  invoiceSentAt: null,
  completedAt: null,
  customer: null,
  email: null,
  phone: null,
  shippingAddress: {
    name: null,
    phone: null,
    line1: "5 Nile St",
    line2: null,
    city: "Cairo",
    province: null,
    postalCode: "",
    country: "EG",
  },
  billingAddress: null,
  lines: [],
  discount: { valueType: "fixed", value: 5000, reason: "Loyal", amountMinor: 5000 },
  shipping: { kind: "rate", method: "standard", title: "Standard", amountMinor: 500 },
  note: null,
  tags: [],
  totals: {
    subtotalMinor: 50000,
    discountMinor: 5000,
    shippingMinor: 500,
    taxMinor: 6000,
    taxIncluded: false,
    totalMinor: 51500,
  },
  order: null,
  links: [],
  missing: { invoice: [], complete: ["email"] },
};

function renderCard(
  overrides: Partial<Parameters<typeof DraftPaymentCard>[0]> = {},
  draft: DraftOrderDto = DTO,
) {
  const props = {
    draft,
    form: formFromDraft(draft),
    dirty: false,
    editable: true,
    canMarkPaid: true,
    pending: false,
    activity: null,
    onDiscount: vi.fn(),
    onShipping: vi.fn(),
    saveFirst: vi.fn(async () => draft),
    onSendInvoice: vi.fn(),
    onCollect: vi.fn(),
    errors: {},
    t: en,
    locale: "en" as const,
    ...overrides,
  };
  render(<DraftPaymentCard {...props} />);
  return props;
}

const row = (label: string) => screen.getByText(label).closest("div") as HTMLElement;

afterEach(() => {
  draftShippingRatesAction.mockReset();
});

describe("DraftPaymentCard", () => {
  it("shows the saved totals: subtotal, discount, shipping, tax and total", () => {
    renderCard();
    expect(within(row(p.subtotal)).getByText("EGP 500.00")).toBeInTheDocument();
    expect(within(row(p.discount)).getByText("−EGP 50.00")).toBeInTheDocument();
    expect(within(row(p.shipping)).getByText("EGP 5.00")).toBeInTheDocument();
    expect(within(row(p.tax)).getByText("EGP 60.00")).toBeInTheDocument();
    expect(within(row(p.total)).getByText("EGP 515.00")).toBeInTheDocument();
  });

  it("says tax is included when prices include it", () => {
    renderCard({}, { ...DTO, totals: { ...DTO.totals, taxIncluded: true, totalMinor: 45500 } });
    expect(screen.getByText("Including EGP 60.00 in taxes")).toBeInTheDocument();
  });

  it("without an address, tax is 'Calculated after an address is added'", () => {
    renderCard({}, { ...DTO, shippingAddress: null, totals: { ...DTO.totals, taxMinor: null } });
    expect(screen.getByText(p.taxPending)).toBeInTheDocument();
  });

  it("with an address but no estimate, tax says the estimate is unavailable", () => {
    renderCard({}, { ...DTO, totals: { ...DTO.totals, taxMinor: null } });
    expect(screen.getByText(p.taxUnavailable)).toBeInTheDocument();
    expect(screen.queryByText(p.taxPending)).toBeNull();
  });

  it("says 'Save to update totals' while there are unsaved changes (Ruling 14)", () => {
    renderCard({ dirty: true });
    expect(screen.getByText(p.saveToUpdate)).toBeInTheDocument();
  });

  it("lists what the draft still needs, the complete-only email included", () => {
    renderCard();
    expect(screen.getByText(en.draftOrders.editor.missing.email)).toBeInTheDocument();
  });

  it("the discount dialog's Apply writes the merchant's terms", () => {
    const props = renderCard({}, { ...DTO, discount: null });
    fireEvent.click(screen.getByRole("button", { name: p.addDiscount }));
    const d = en.draftOrders.editor.discountDialog;
    fireEvent.click(screen.getByLabelText(d.percentage));
    fireEvent.change(screen.getByLabelText(d.value), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: d.apply }));
    expect(props.onDiscount).toHaveBeenCalledWith({
      valueType: "percentage",
      value: 10,
      reason: "",
    });
  });

  it("the discount dialog refuses a percentage over 100", () => {
    renderCard({}, { ...DTO, discount: null });
    fireEvent.click(screen.getByRole("button", { name: p.addDiscount }));
    const d = en.draftOrders.editor.discountDialog;
    fireEvent.click(screen.getByLabelText(d.percentage));
    fireEvent.change(screen.getByLabelText(d.value), { target: { value: "150" } });
    expect(screen.getByRole("button", { name: d.apply })).toBeDisabled();
  });

  it("a fixed discount is typed in money and sent in minor units, Arabic digits too", () => {
    const props = renderCard({}, { ...DTO, discount: null });
    fireEvent.click(screen.getByRole("button", { name: p.addDiscount }));
    const d = en.draftOrders.editor.discountDialog;
    fireEvent.change(screen.getByLabelText(d.value), { target: { value: "٢٥٫٥" } });
    fireEvent.change(screen.getByLabelText(d.reason), { target: { value: "Loyal" } });
    fireEvent.click(screen.getByRole("button", { name: d.apply }));
    expect(props.onDiscount).toHaveBeenCalledWith({
      valueType: "fixed",
      value: 2550,
      reason: "Loyal",
    });
  });

  it("the shipping dialog with no saved address says 'Add products and a shipping address first.'", async () => {
    const noAddress = { ...DTO, shippingAddress: null };
    const props = renderCard({ saveFirst: vi.fn(async () => noAddress) }, noAddress);
    fireEvent.click(screen.getByRole("button", { name: p.shipping }));
    expect(
      await screen.findByText(en.draftOrders.editor.shippingDialog.needsAddress),
    ).toBeInTheDocument();
    expect(props.saveFirst).toHaveBeenCalledTimes(1);
    expect(draftShippingRatesAction).not.toHaveBeenCalled();
  });

  it("the shipping dialog saves first, then offers the shop's rates for the saved draft", async () => {
    const withLines = {
      ...DTO,
      lines: [
        {
          productId: "p-1",
          variantId: "v-1",
          sku: "TEE",
          title: "Tee",
          variantTitle: null,
          quantity: 1,
          unitPriceMinor: 50000,
          lineTotalMinor: 50000,
          imageUrl: null,
        },
      ],
    };
    draftShippingRatesAction.mockResolvedValue({
      ok: true,
      rates: [{ method: "express", title: "Express", amountMinor: 3000 }],
    });
    const props = renderCard({ saveFirst: vi.fn(async () => withLines) }, withLines);
    fireEvent.click(screen.getByRole("button", { name: p.shipping }));
    fireEvent.click(await screen.findByLabelText(/Express/));
    fireEvent.click(
      screen.getByRole("button", { name: en.draftOrders.editor.shippingDialog.apply }),
    );
    expect(draftShippingRatesAction).toHaveBeenCalledWith(withLines.id);
    expect(props.onShipping).toHaveBeenCalledWith({
      kind: "rate",
      method: "express",
      title: "Express",
      amountMinor: 3000,
    });
  });

  it("Mark as paid hands the choice to the editor, which confirms after saving (Pre-flight 11)", async () => {
    const props = renderCard();
    fireEvent.keyDown(screen.getByRole("button", { name: p.collectPayment }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: p.markAsPaid }));
    expect(props.onCollect).toHaveBeenCalledWith("paid");
  });

  it("disables Send invoice and Collect payment while something is running", () => {
    renderCard({ pending: true, activity: "complete" });
    expect(screen.getByRole("button", { name: p.sendInvoice })).toBeDisabled();
    expect(screen.getByRole("button", { name: p.collectPayment })).toBeDisabled();
    expect(screen.getByText(p.working)).toBeInTheDocument();
  });

  it("formats the totals for an Arabic reader", () => {
    renderCard({ t: ar, locale: "ar" });
    const a = ar.draftOrders.editor.payment;
    expect(screen.getByText(a.total)).toBeInTheDocument();
    expect(
      within(screen.getByText(a.total).closest("div") as HTMLElement).getByText(/ج.م./),
    ).toBeInTheDocument();
  });
});
