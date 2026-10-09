import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { PaymentIntentDto } from "@/lib/api/payments";
import { OrderPaymentCard } from "./order-payment-card";

const fetchPaymentIntent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/payments", () => ({ fetchPaymentIntent }));
vi.mock("@/app/orders/actions", () => ({ confirmCodCollectionAction: vi.fn() }));

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

async function renderCard(paymentIntent: PaymentIntentDto) {
  fetchPaymentIntent.mockResolvedValue({ outcome: "ok", paymentIntent });
  render(
    await OrderPaymentCard({ orderId: "order-1", paymentRef: "intent-1", t: en, locale: "en" }),
  );
}

beforeEach(() => {
  fetchPaymentIntent.mockReset();
});

const collect = () => screen.queryByRole("button", { name: en.orderDetail.markCashReceived });

describe("OrderPaymentCard — cash on delivery (Plan 3A)", () => {
  it("offers Mark cash as received for a cash-on-delivery payment that is not yet collected", async () => {
    await renderCard(intent());

    expect(collect()).toBeInTheDocument();
  });

  it("names the method: Cash on delivery", async () => {
    await renderCard(intent());

    expect(screen.getByText(en.orderDetail.paymentMethodCod)).toBeInTheDocument();
  });

  it("offers nothing once the cash is collected", async () => {
    await renderCard(intent({ status: "captured", capturedAmountMinor: 45000 }));

    expect(collect()).toBeNull();
  });

  it("offers nothing for a captured status even if the captured amount is missing", async () => {
    await renderCard(intent({ status: "captured" }));

    expect(collect()).toBeNull();
  });

  it("offers nothing for a refunded or closed cash payment", async () => {
    for (const status of ["refunded", "partially_refunded", "closed", "cancelled", "failed"]) {
      document.body.innerHTML = "";
      await renderCard(intent({ status }));
      expect(collect(), status).toBeNull();
    }
  });

  it("offers nothing for a card payment, which settles by itself", async () => {
    await renderCard(intent({ provider: "stripe" }));

    expect(collect()).toBeNull();
    expect(screen.getByText(en.paymentSettings.methodStripe)).toBeInTheDocument();
  });

  it("shows an unknown method as its key", async () => {
    await renderCard(intent({ provider: "fawry" }));

    expect(screen.getByText("fawry")).toBeInTheDocument();
    expect(collect()).toBeNull();
  });
});
