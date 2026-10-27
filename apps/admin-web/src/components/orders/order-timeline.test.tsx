import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TimelineEntryDto } from "@/lib/api/orders";
import { isolateName } from "@/lib/orders/order-timeline";
import { ar } from "@/messages/ar";
import { en } from "@/messages/en";
import { OrderTimeline } from "./order-timeline";

vi.mock("@/app/orders/annotation-actions", () => ({
  postOrderCommentAction: vi.fn(),
  editOrderCommentAction: vi.fn(),
  deleteOrderCommentAction: vi.fn(),
}));

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

describe("OrderTimeline — staff comments and activity (order operations Part 2)", () => {
  const staffLine = (overrides: Partial<TimelineEntryDto>): TimelineEntryDto => ({
    id: "e-1",
    kind: "comment",
    authorName: "Ahmed",
    body: "Called",
    data: {},
    createdAt: "2026-10-19T08:00:00.000Z",
    editedAt: null,
    deleted: false,
    canEdit: false,
    canDelete: false,
    ...overrides,
  });

  function renderMerged(entries: TimelineEntryDto[], canComment = false) {
    render(
      <OrderTimeline
        history={[
          { type: "created", occurredAt: "2026-10-18T20:00:00.000Z" },
          { type: "confirmed", occurredAt: "2026-10-18T22:30:00.000Z" },
        ]}
        totalMinor={1999}
        currency="USD"
        paymentProvider="cod"
        t={en}
        locale="en"
        entries={entries}
        timeZone="Africa/Cairo"
        orderId="o-1"
        canComment={canComment}
      />,
    );
  }

  it("merges events and staff lines newest first, one section per shop day", () => {
    renderMerged([
      staffLine({
        id: "e-2",
        kind: "tags_added",
        body: null,
        data: { tags: ["VIP", "urgent"] },
        createdAt: "2026-10-19T09:00:00.000Z",
      }),
      staffLine({}),
    ]);
    expect(screen.getAllByRole("region")).toHaveLength(2);
    expect(screen.getAllByRole("listitem").map(firstLine)).toEqual([
      `${isolateName("Ahmed")} added tags ${isolateName("VIP")}, ${isolateName("urgent")}`,
      "Called",
      "Order confirmed",
      "Order placed",
    ]);
  });

  it('shows a deleted comment as "Comment deleted" with no buttons', () => {
    renderMerged([staffLine({ deleted: true, body: null, canEdit: false, canDelete: false })]);
    expect(screen.getByText("Comment deleted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("names who wrote a deleted comment, and when, with the name isolated from the line", () => {
    renderMerged([staffLine({ deleted: true, body: null, authorName: "أحمد" })]);
    const item = screen.getByText("Comment deleted").closest("li") as HTMLElement;
    expect(item.textContent).toContain("⁨أحمد⁩");
    expect(item.textContent).toMatch(/⁩ · .*\d/);
  });

  it("links 'Order created from draft #D3' to its draft, the number isolated (Ruling 24)", () => {
    renderMerged([
      staffLine({
        id: "e-3",
        kind: "created_from_draft",
        authorName: null,
        body: null,
        data: { draftNumber: "D3", draftId: "d-1" },
      }),
      staffLine({ id: "e-4", kind: "archived", body: null, data: {} }),
    ]);
    const link = screen.getByRole("link", { name: /Order created from draft/ });
    expect(link).toHaveAttribute("href", "/draft-orders/d-1");
    expect(link.textContent).toBe(`Order created from draft ${isolateName("#D3")}`);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("shows a staff entry of an unknown kind as generic staff activity, never blank", () => {
    renderMerged([
      staffLine({ kind: "future_kind" as TimelineEntryDto["kind"], body: null, data: {} }),
    ]);
    expect(screen.getByText("Staff activity")).toBeInTheDocument();
  });

  it("offers the composer only to staff who may comment", () => {
    renderMerged([], false);
    expect(screen.queryByPlaceholderText("Leave a comment...")).toBeNull();
    document.body.innerHTML = "";
    renderMerged([], true);
    expect(screen.getByPlaceholderText("Leave a comment...")).toBeInTheDocument();
  });
});
