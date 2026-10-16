import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrderTimeline } from "./order-timeline";

const EVENT_TYPES = [
  "placed",
  "paid",
  "refunded",
  "created",
  "confirmed",
  "cancelled",
  "held",
  "resumed",
  "awaiting_payment",
  "payment_requested",
  "payment_received",
  "payment_failed",
  "ready_for_fulfillment",
  "fulfillment_requested",
  "fulfilled",
  "partially_fulfilled",
  "delivered",
  "return_requested",
  "returned",
  "refund_requested",
  "closed",
] as const;

const entry = (type: string, minute = 0) => ({
  type,
  occurredAt: new Date(2026, 9, 9, 20, minute).toISOString(),
});

function renderTimeline(
  history: { type: string; occurredAt: string }[],
  paymentProvider: string | null = "cod",
  locale: "en" | "ar" = "en",
) {
  render(
    <OrderTimeline
      history={history}
      totalMinor={1999}
      currency="USD"
      paymentProvider={paymentProvider}
      t={locale === "en" ? en : ar}
      locale={locale}
    />,
  );
}

const firstLine = (li: HTMLElement) => li.querySelector("p")?.textContent;

describe("OrderTimeline — in words (Plan 3B)", () => {
  it("says Order placed for the first event", () => {
    renderTimeline([entry("created")]);

    expect(screen.getByText("Order placed")).toBeInTheDocument();
  });

  it("says what is pending, how much, and how the customer pays", () => {
    renderTimeline([entry("created"), entry("payment_requested", 1)]);

    expect(screen.getByText("Payment of $19.99 pending (Cash on delivery)")).toBeInTheDocument();
  });

  it("drops the parenthesis when the method is not known", () => {
    renderTimeline([entry("payment_requested")], null);

    expect(screen.getByText("Payment of $19.99 pending")).toBeInTheDocument();
  });

  it("says when a payment was received", () => {
    renderTimeline([entry("payment_received")]);

    expect(screen.getByText("Payment of $19.99 received")).toBeInTheDocument();
  });

  it("lists the newest event first", () => {
    renderTimeline([entry("created", 0), entry("confirmed", 1), entry("cancelled", 2)]);

    expect(screen.getAllByRole("listitem").map(firstLine)).toEqual([
      "Order cancelled",
      "Order confirmed",
      "Order placed",
    ]);
  });

  it("has words for every lifecycle event, in both languages — never a raw code", () => {
    for (const locale of ["en", "ar"] as const) {
      for (const type of EVENT_TYPES) {
        document.body.innerHTML = "";
        renderTimeline([entry(type)], "cod", locale);
        const text = firstLine(screen.getByRole("listitem")) ?? "";
        expect(text, `${locale}: ${type}`).not.toBe(type);
        expect(text, `${locale}: ${type}`).not.toMatch(/[{}]/);
        expect(text.length, `${locale}: ${type}`).toBeGreaterThan(3);
      }
    }
  });

  it("shows an event this build has no words for as its raw name", () => {
    renderTimeline([entry("some_future_event")]);

    expect(screen.getByText("some_future_event")).toBeInTheDocument();
  });

  it("is in Arabic on an Arabic page", () => {
    renderTimeline([entry("created")], "cod", "ar");

    expect(screen.getByText("تم إنشاء الطلب")).toBeInTheDocument();
  });
});
