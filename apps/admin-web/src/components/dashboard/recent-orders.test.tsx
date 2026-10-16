import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { FetchOrdersResult, OrderListItemDto } from "@/lib/api/orders";
import { dictionaryFor } from "@/lib/i18n";
import { en, type Dictionary } from "@/messages/en";

/** The Arabic dictionary, typed as the widened `Dictionary` the components take. */
const ar: Dictionary = dictionaryFor("ar");

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const fetchRecentOrders = vi.fn<(first: number) => Promise<FetchOrdersResult>>();
vi.mock("@/lib/api/orders", () => ({
  fetchRecentOrders: (first: number) => fetchRecentOrders(first),
}));

const { RecentOrders } = await import("./recent-orders");
const { RecentOrdersSection } = await import("./recent-orders-section");

const NOW = new Date("2026-10-13T12:00:00.000Z");

function order(overrides: Partial<OrderListItemDto> = {}): OrderListItemDto {
  return {
    id: "o-1",
    orderNumber: "1042",
    customerRef: "c-1",
    status: "payment_received",
    currency: "EGP",
    totalMinor: 125_000,
    createdAt: "2026-10-13T11:30:00.000Z",
    customerName: "Mona Adel",
    itemCount: 2,
    shippingMethod: "standard",
    paymentStatus: "paid",
    fulfillmentStatus: "unfulfilled",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  fetchRecentOrders.mockReset();
  refresh.mockReset();
});

describe("RecentOrders", () => {
  it("shows the number, the customer, when it was placed and the total, linked to the order", () => {
    render(<RecentOrders orders={[order()]} t={en} locale="en" now={NOW} />);

    const link = screen.getByRole("link", { name: "#1042" });
    expect(link).toHaveAttribute("href", "/orders/o-1");
    expect(screen.getByText(/Mona Adel/)).toBeInTheDocument();
    expect(screen.getByText(/30 minutes ago/)).toBeInTheDocument();
    expect(screen.getByText("EGP 1,250.00")).toBeInTheDocument();
  });

  it("shows the two Shopify statuses, from the same badges as the orders list", () => {
    render(
      <RecentOrders
        orders={[order({ paymentStatus: "pending", fulfillmentStatus: "in_progress" })]}
        t={en}
        locale="en"
        now={NOW}
      />,
    );

    expect(screen.getByText(en.orderPaymentStatus.pending)).toBeInTheDocument();
    expect(screen.getByText(en.orderFulfillmentStatus.in_progress)).toBeInTheDocument();
  });

  it("has neither the old Processing bucket nor an initials avatar", () => {
    render(
      <RecentOrders orders={[order({ customerName: "Mona Adel" })]} t={en} locale="en" now={NOW} />,
    );

    expect(document.body.textContent).not.toMatch(/processing/i);
    expect(screen.queryByText("MA")).not.toBeInTheDocument();
  });

  it("says No customer, not a made-up name, for an order whose customer is unknown", () => {
    render(<RecentOrders orders={[order({ customerName: null })]} t={en} locale="en" now={NOW} />);

    expect(screen.getByText(new RegExp(en.ordersPage.noCustomer))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Customer [0-9A-F]{6}/);
  });

  it("links to the whole orders list", () => {
    render(<RecentOrders orders={[order()]} t={en} locale="en" now={NOW} />);

    expect(screen.getByRole("link", { name: /View all/ })).toHaveAttribute("href", "/orders");
  });

  it("reads in Arabic", () => {
    render(<RecentOrders orders={[order()]} t={ar} locale="ar" now={NOW} />);

    expect(screen.getByText("آخر الطلبات")).toBeInTheDocument();
    expect(screen.getByText(ar.orderPaymentStatus.paid)).toBeInTheDocument();
  });
});

describe("RecentOrdersSection", () => {
  it("fetches the latest five, whatever the date range", async () => {
    fetchRecentOrders.mockResolvedValue({ outcome: "ok", orders: [order()] });

    render(await RecentOrdersSection({ t: en, locale: "en" }));

    expect(fetchRecentOrders).toHaveBeenCalledWith(5);
    expect(screen.getByRole("link", { name: "#1042" })).toBeInTheDocument();
  });

  it("says there are no orders yet when there are none", async () => {
    fetchRecentOrders.mockResolvedValue({ outcome: "ok", orders: [] });

    render(await RecentOrdersSection({ t: en, locale: "en" }));

    expect(screen.getByText("No orders yet.")).toBeInTheDocument();
  });

  it("shows an error with Try again, and no orders, when the API cannot be reached", async () => {
    fetchRecentOrders.mockResolvedValue({ outcome: "error", message: "connect ECONNREFUSED" });

    render(await RecentOrdersSection({ t: en, locale: "en" }));

    const card = screen.getByText("Recent orders").closest("div")?.parentElement as HTMLElement;
    expect(within(card).getByText("Couldn't load")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /#/ })).not.toBeInTheDocument();
  });

  it("explains a refusal instead of offering a retry", async () => {
    fetchRecentOrders.mockResolvedValue({ outcome: "unauthorized" });

    render(await RecentOrdersSection({ t: en, locale: "en" }));

    expect(screen.getByText(en.recentOrders.unauthorized)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
