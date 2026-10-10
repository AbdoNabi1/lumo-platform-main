import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { OrderDetailDto } from "@/lib/api/orders";
import type { PaymentIntentDto } from "@/lib/api/payments";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrderPaymentCard } from "./order-payment-card";

const fetchPaymentIntent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/payments", () => ({ fetchPaymentIntent }));
vi.mock("@/app/orders/actions", () => ({
  confirmCodCollectionAction: vi.fn(),
  markOrderPaidAction: vi.fn(),
}));

function intent(overrides: Partial<PaymentIntentDto> = {}): PaymentIntentDto {
  return {
    id: "intent-1",
    orderRef: "order-1",
    provider: "cod",
    status: "created",
    currency: "EGP",
    amountMinor: 45000,
    authorizedAmountMinor: null,
    capturedAmountMinor: 0,
    refundedAmountMinor: 0,
    pspReference: null,
    capturedAt: null,
    refundedAt: null,
    ...overrides,
  };
}

function order(overrides: Partial<OrderDetailDto> = {}): OrderDetailDto {
  return {
    id: "order-1",
    orderNumber: "1001",
    customerRef: "customer-1",
    status: "payment_requested",
    currency: "EGP",
    totalMinor: 45000,
    createdAt: new Date(2026, 9, 9, 20, 27).toISOString(),
    items: [
      {
        id: "item-1",
        productId: "product-1",
        name: "Shirt",
        variantRef: null,
        sku: null,
        variantTitle: null,
        unitPriceMinor: 12000,
        quantity: 3,
        lineTotalMinor: 36000,
      },
    ],
    shippingAddress: {
      line1: "1 Main St",
      city: "Cairo",
      postalCode: "",
      country: "EG",
      recipientName: null,
      phone: null,
      line2: null,
    },
    billingAddress: null,
    totals: {
      subtotalMinor: 36000,
      taxMinor: 4000,
      shippingMinor: 5000,
      discountMinor: 0,
      totalMinor: 45000,
      currency: "EGP",
    },
    checkoutRef: "checkout-1",
    paymentRef: "intent-1",
    fulfillmentRef: null,
    history: [],
    paymentStatus: "pending",
    fulfillmentStatus: "unfulfilled",
    paymentProvider: "cod",
    shippingMethod: "standard",
    ...overrides,
  };
}

async function renderCard(
  o: OrderDetailDto,
  paymentIntent: PaymentIntentDto | null = intent(),
  locale: "en" | "ar" = "en",
) {
  fetchPaymentIntent.mockResolvedValue(
    paymentIntent === null
      ? { outcome: "error", message: "down" }
      : { outcome: "ok", paymentIntent },
  );
  render(await OrderPaymentCard({ order: o, t: locale === "en" ? en : ar, locale }));
}

beforeEach(() => {
  fetchPaymentIntent.mockReset();
});

const markAsPaid = () => screen.queryByRole("button", { name: en.orderPage.markAsPaid });
/** The row whose label is exactly `label` (its first text node — a note may follow in a span). */
const row = (label: string) => {
  const dt = screen.getByText((_content, element) => {
    return element?.tagName === "DT" && element.childNodes[0]?.textContent === label;
  });
  return within(dt.closest("div") as HTMLElement);
};

describe("OrderPaymentCard — the payment card like Shopify's (Plan 3B)", () => {
  it("is titled with the payment status", async () => {
    await renderCard(order());

    expect(screen.getByText("Payment pending")).toBeInTheDocument();
  });

  it("breaks the total down: subtotal with the item count, shipping with the method, taxes, total", async () => {
    await renderCard(order());

    expect(row("Subtotal").getByText("3 items")).toBeInTheDocument();
    expect(row("Subtotal").getByText(/360\.00/)).toBeInTheDocument();
    expect(row("Shipping").getByText("Standard shipping")).toBeInTheDocument();
    expect(row("Shipping").getByText(/50\.00/)).toBeInTheDocument();
    expect(row("Taxes").getByText(/40\.00/)).toBeInTheDocument();
    const total = row("Total");
    expect(total.getByText(/450\.00/)).toBeInTheDocument();
    expect(total.getByText(/450\.00/).closest("div")).toHaveClass("font-semibold");
  });

  it("shows a discount only when there is one", async () => {
    await renderCard(order());
    expect(screen.queryByText("Discount")).toBeNull();
  });

  it("while pending: Paid by customer is nothing and the Balance is the whole total", async () => {
    await renderCard(order());

    expect(row("Paid by customer").getByText(/0\.00/)).toBeInTheDocument();
    expect(row("Balance").getByText(/450\.00/)).toBeInTheDocument();
  });

  it("once paid: Paid by customer is the captured amount and there is no Balance", async () => {
    await renderCard(
      order({ paymentStatus: "paid", status: "payment_received" }),
      intent({ status: "captured", capturedAmountMinor: 45000 }),
    );

    expect(row("Paid by customer").getByText(/450\.00/)).toBeInTheDocument();
    expect(screen.queryByText("Balance")).toBeNull();
    expect(screen.getByText("Paid", { selector: "span,div" })).toBeInTheDocument();
  });

  it("names how the customer pays", async () => {
    await renderCard(order({ paymentProvider: "cod" }));
    expect(row("Payment method").getByText("Cash on delivery")).toBeInTheDocument();
  });

  it("names a card payment, and shows a dash while no payment is linked", async () => {
    await renderCard(order({ paymentProvider: "stripe" }), intent({ provider: "stripe" }));
    expect(row("Payment method").getByText("Card (Stripe)")).toBeInTheDocument();
  });

  it("still shows the totals when Payments cannot be reached", async () => {
    await renderCard(order(), null);

    expect(row("Total").getByText(/450\.00/)).toBeInTheDocument();
    expect(screen.getByText(en.orderDetail.paymentUnavailable)).toBeInTheDocument();
  });

  describe("Mark as paid", () => {
    it("is offered for a cash-on-delivery payment that is pending and not yet collected", async () => {
      await renderCard(order());

      expect(markAsPaid()).toBeInTheDocument();
    });

    it("is not offered once the cash is collected", async () => {
      await renderCard(
        order({ paymentStatus: "paid", status: "payment_received" }),
        intent({ status: "captured", capturedAmountMinor: 45000 }),
      );

      expect(markAsPaid()).toBeNull();
    });

    it("is not offered for a card payment, which settles by itself", async () => {
      await renderCard(order({ paymentProvider: "stripe" }), intent({ provider: "stripe" }));

      expect(markAsPaid()).toBeNull();
    });

    it.each(["refunded", "partially_refunded", "closed", "cancelled", "failed"])(
      "is not offered for a cash payment that is %s",
      async (status) => {
        await renderCard(order(), intent({ status }));

        expect(markAsPaid()).toBeNull();
      },
    );

    it("asks for a payment reference when NO payment is linked and the order is still placed", async () => {
      await renderCard(order({ paymentRef: null, paymentProvider: null, status: "placed" }), null);

      expect(markAsPaid()).toBeInTheDocument();
      expect(fetchPaymentIntent).not.toHaveBeenCalled();
    });

    it("is hidden when no payment is linked but the action could not succeed (the order is not placed)", async () => {
      await renderCard(order({ paymentRef: null, paymentProvider: null, status: "created" }), null);

      expect(markAsPaid()).toBeNull();
    });

    it("is hidden on an order that is voided", async () => {
      await renderCard(
        order({
          paymentRef: null,
          paymentProvider: null,
          status: "cancelled",
          paymentStatus: "voided",
        }),
        null,
      );

      expect(markAsPaid()).toBeNull();
    });
  });

  it("renders in Arabic", async () => {
    await renderCard(order(), intent(), "ar");

    expect(screen.getByText("في انتظار الدفع")).toBeInTheDocument();
    expect(screen.getByText("الدفع عند الاستلام")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تحديد كمدفوع" })).toBeInTheDocument();
    expect(screen.getByText(ar.orderPage.balance)).toBeInTheDocument();
  });
});
