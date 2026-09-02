import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { FormState } from "@/lib/api/mutation";
import { OrderLifecycleActions } from "./order-lifecycle-actions";

const advanceOrderAction = vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
const markOrderPaidAction = vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
const refundOrderAction = vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
const requestPaymentCaptureAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();
const requestFulfillmentAction =
  vi.fn<(previous: FormState, formData: FormData) => Promise<FormState>>();

vi.mock("@/app/orders/actions", () => ({
  advanceOrderAction: (previous: FormState, formData: FormData) =>
    advanceOrderAction(previous, formData),
  markOrderPaidAction: (previous: FormState, formData: FormData) =>
    markOrderPaidAction(previous, formData),
  refundOrderAction: (previous: FormState, formData: FormData) =>
    refundOrderAction(previous, formData),
  requestPaymentCaptureAction: (previous: FormState, formData: FormData) =>
    requestPaymentCaptureAction(previous, formData),
  requestFulfillmentAction: (previous: FormState, formData: FormData) =>
    requestFulfillmentAction(previous, formData),
}));

beforeEach(() => {
  advanceOrderAction.mockReset();
  markOrderPaidAction.mockReset();
  refundOrderAction.mockReset();
  requestPaymentCaptureAction.mockReset();
  requestFulfillmentAction.mockReset();
});

describe("OrderLifecycleActions", () => {
  it("offers an advance dropdown excluding paid, plus mark-paid/request actions, for a placed order", () => {
    render(<OrderLifecycleActions orderId="order-1" status="placed" t={en} />);

    // "placed" transitions to [paid, cancelled] per the lifecycle table, but paid is excluded —
    // only cancelled should be offered.
    expect(screen.getByRole("option", { name: en.orderStatus.cancelled })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: en.orderStatus.paid })).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: en.orderLifecycle.advance })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.orderLifecycle.markPaid })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.orderLifecycle.requestPaymentCapture }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.orderLifecycle.requestFulfillment }),
    ).toBeInTheDocument();
  });

  it("offers refund for a paid order", () => {
    render(<OrderLifecycleActions orderId="order-1" status="paid" t={en} />);
    expect(screen.getByRole("button", { name: en.orderLifecycle.refund })).toBeInTheDocument();
  });

  it("does not offer refund for a placed order", () => {
    render(<OrderLifecycleActions orderId="order-1" status="placed" t={en} />);
    expect(
      screen.queryByRole("button", { name: en.orderLifecycle.refund }),
    ).not.toBeInTheDocument();
  });

  it("renders no advance dropdown for a terminal status with no allowed transitions", () => {
    render(<OrderLifecycleActions orderId="order-1" status="closed" t={en} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.orderLifecycle.advance }),
    ).not.toBeInTheDocument();
  });

  it("excludes payment_received from the advance dropdown for payment_requested", () => {
    render(<OrderLifecycleActions orderId="order-1" status="payment_requested" t={en} />);
    expect(
      screen.getByRole("option", { name: en.orderStatus.payment_failed }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: en.orderStatus.payment_received }),
    ).not.toBeInTheDocument();
  });
});
