import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { OrderDetailDto } from "@/lib/api/orders";
import { ar } from "@/messages/ar";
import { en, type Dictionary } from "@/messages/en";
import { OrderHeader } from "./order-header";

vi.mock("@/app/orders/actions", () => ({
  advanceOrderAction: vi.fn(),
  refundOrderAction: vi.fn(),
  archiveOrderAction: vi.fn(),
  unarchiveOrderAction: vi.fn(),
}));

function order(overrides: Partial<OrderDetailDto> = {}): OrderDetailDto {
  return {
    id: "order-1",
    orderNumber: "1001",
    status: "payment_requested",
    createdAt: new Date(2026, 9, 9, 20, 27).toISOString(),
    paymentStatus: "pending",
    fulfillmentStatus: "unfulfilled",
    currency: "EGP",
    totalMinor: 3998,
    paymentProvider: "cod",
    refundable: false,
    ...overrides,
  } as OrderDetailDto;
}

describe("OrderHeader (Plan 3B)", () => {
  it("shows the short number and both badges", () => {
    render(<OrderHeader order={order()} t={en} locale="en" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("#1001");
    expect(screen.getByText("Payment pending")).toBeInTheDocument();
    expect(screen.getByText("Unfulfilled")).toBeInTheDocument();
  });

  it("shows the badges that match the order's two statuses", () => {
    render(
      <OrderHeader
        order={order({ paymentStatus: "paid", fulfillmentStatus: "delivered" })}
        t={en}
        locale="en"
      />,
    );

    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Delivered")).toBeInTheDocument();
  });

  it("says when and where the order was placed", () => {
    render(<OrderHeader order={order()} t={en} locale="en" />);

    expect(screen.getByText("October 9, 2026 at 8:27 pm from Online Store")).toBeInTheDocument();
  });

  it("links back to the orders list", () => {
    render(<OrderHeader order={order()} t={en} locale="en" />);

    expect(screen.getByRole("link", { name: en.orderDetail.back })).toHaveAttribute(
      "href",
      "/orders",
    );
  });

  it("enables Refund exactly when the server says the order is refundable — the page does not guess from the status", () => {
    const { rerender } = render(
      <OrderHeader
        order={order({ status: "payment_received", refundable: true })}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByRole("button", { name: "Refund" })).toBeEnabled();

    rerender(
      <OrderHeader
        order={order({ status: "payment_received", refundable: false })}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByRole("button", { name: "Refund" })).toBeDisabled();

    rerender(
      <OrderHeader order={order({ status: "paid", refundable: false })} t={en} locale="en" />,
    );
    expect(screen.getByRole("button", { name: "Refund" })).toBeDisabled();
  });

  describe("the Refund confirmation", () => {
    function confirmFor(
      overrides: Partial<OrderDetailDto>,
      t: Dictionary = en,
      locale: "en" | "ar" = "en",
    ) {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(
        <OrderHeader order={order({ refundable: true, ...overrides })} t={t} locale={locale} />,
      );
      fireEvent.click(screen.getByRole("button", { name: t.orderPage.refund }));
      const message = String(confirm.mock.calls[0]?.[0]);
      confirm.mockRestore();
      return message;
    }

    it("names the amount that goes back to the customer", () => {
      const message = confirmFor({ paymentProvider: "stripe", totalMinor: 3998, currency: "USD" });

      expect(message).toBe("Refund $39.98 to the customer?");
    });

    it("for cash on delivery adds that the merchant returns the cash themselves", () => {
      const message = confirmFor({ paymentProvider: "cod", totalMinor: 3998, currency: "USD" });

      expect(message).toBe(
        "Refund $39.98 to the customer?\n\nYou'll return the cash yourself; this records it.",
      );
    });

    it("for a payment marked as paid (manual) says to return the money the way it came (M-3)", () => {
      const message = confirmFor({ paymentProvider: "manual", totalMinor: 3998, currency: "USD" });

      expect(message).toBe(
        "Refund $39.98 to the customer?\n\nReturn the money the way you received it; this records it.",
      );
      expect(message).not.toContain(en.orderPage.confirmRefundCash);
    });

    it("says it in Egyptian Arabic for a manual payment", () => {
      const message = confirmFor({ paymentProvider: "manual" }, ar, "ar");

      expect(message).toContain(ar.orderPage.confirmRefundManual);
      expect(ar.orderPage.confirmRefundManual).toBe(
        "رجّع الفلوس للعميل بنفس الطريقة اللي استلمتها بيها؛ ده بيسجّل الاسترداد بس.",
      );
    });

    it("is available in Arabic, with the cash line for cash on delivery", () => {
      const message = confirmFor({ paymentProvider: "cod" }, ar, "ar");

      expect(message).toContain(ar.orderPage.confirmRefundCash);
      expect(message).not.toContain("{amount}");
      expect(ar.orderPage.confirmRefund).toContain("{amount}");
    });
  });

  it("offers More actions with Cancel order only where the lifecycle allows it", () => {
    const { rerender } = render(
      <OrderHeader order={order({ status: "created" })} t={en} locale="en" />,
    );
    expect(screen.getByText("More actions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();

    // G-126: an unpaid cash-on-delivery order waits at payment_requested and can be cancelled.
    rerender(<OrderHeader order={order({ status: "payment_requested" })} t={en} locale="en" />);
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Print packing slip" })).toBeInTheDocument();

    // Once the payment is received the order is refunded, never cancelled.
    rerender(<OrderHeader order={order({ status: "payment_received" })} t={en} locale="en" />);
    expect(screen.queryByRole("button", { name: "Cancel order" })).toBeNull();
    expect(screen.getByRole("link", { name: "Print packing slip" })).toBeInTheDocument();
  });

  it("renders in Arabic", () => {
    render(<OrderHeader order={order()} t={ar} locale="ar" />);

    expect(screen.getByText("في انتظار الدفع")).toBeInTheDocument();
    expect(screen.getByText("لم يتم التجهيز")).toBeInTheDocument();
    expect(screen.getByText(/من المتجر الإلكتروني/)).toBeInTheDocument();
  });

  it("shows an Archived badge on an archived order", () => {
    render(
      <OrderHeader order={order({ archivedAt: "2026-10-18T09:00:00.000Z" })} t={en} locale="en" />,
    );
    expect(screen.getByText("Archived")).toBeInTheDocument();
    render(
      <OrderHeader order={order({ id: "order-2", orderNumber: "1002" })} t={en} locale="en" />,
    );
    expect(screen.getAllByText("Archived")).toHaveLength(1);
  });

  it("offers Archive only when the server says this staff member may archive", () => {
    const { rerender } = render(<OrderHeader order={order()} t={en} locale="en" canArchive />);
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    rerender(<OrderHeader order={order()} t={en} locale="en" canArchive={false} />);
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    rerender(<OrderHeader order={order()} t={en} locale="en" />);
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });
});
