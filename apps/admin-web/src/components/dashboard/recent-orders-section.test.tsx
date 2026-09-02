import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import type { RecentOrdersResult } from "@/data/recent-orders";

const getRecentOrders = vi.fn<() => Promise<RecentOrdersResult>>();
vi.mock("@/data/recent-orders", () => ({ getRecentOrders: () => getRecentOrders() }));

const { RecentOrdersSection, RecentOrdersSkeleton } = await import("./recent-orders-section");

/**
 * These are the states Productization Phase 1 requires the widget to render correctly: success,
 * empty, error, and unauthorized — none of them ever falling back to demo data — plus the
 * `<Suspense>` fallback's skeleton treatment.
 */
describe("RecentOrdersSection", () => {
  it("renders the real orders on success, with a live indicator", async () => {
    getRecentOrders.mockResolvedValue({
      status: "ok",
      orders: [
        {
          id: "order-1",
          reference: "#ORD-1",
          customerName: "Customer ABC123",
          customerInitials: "AB",
          minutesAgo: 3,
          status: "paid",
          total: { amountMinor: 1999, currency: "USD" },
        },
      ],
    });

    render(await RecentOrdersSection({ t: en, locale: "en" }));

    expect(screen.getByText("#ORD-1")).toBeInTheDocument();
    expect(screen.getByText(en.recentOrders.liveBadge)).toBeInTheDocument();
    expect(screen.queryByText(/Amina Haddad/)).not.toBeInTheDocument();
  });

  it("renders an intentional empty state, never demo data", async () => {
    getRecentOrders.mockResolvedValue({ status: "ok", orders: [] });

    render(await RecentOrdersSection({ t: en, locale: "en" }));

    expect(screen.getByText(en.recentOrders.empty)).toBeInTheDocument();
    expect(screen.queryByText(/^#ORD-/)).not.toBeInTheDocument();
  });

  it("renders an intentional error state, never demo data", async () => {
    getRecentOrders.mockResolvedValue({
      status: "error",
      message: "Orders API responded with status 500",
    });

    render(await RecentOrdersSection({ t: en, locale: "en" }));

    expect(screen.getByText(en.recentOrders.error)).toBeInTheDocument();
    expect(screen.queryByText(/^#ORD-/)).not.toBeInTheDocument();
    expect(screen.queryByText(en.recentOrders.liveBadge)).not.toBeInTheDocument();
  });

  it("renders an intentional unauthorized state, never demo data", async () => {
    getRecentOrders.mockResolvedValue({ status: "unauthorized" });

    render(await RecentOrdersSection({ t: en, locale: "en" }));

    expect(screen.getByText(en.recentOrders.unauthorized)).toBeInTheDocument();
    expect(screen.queryByText(/^#ORD-/)).not.toBeInTheDocument();
  });
});

describe("RecentOrdersSkeleton", () => {
  it("renders a busy, labelled loading placeholder", () => {
    render(<RecentOrdersSkeleton t={en} />);
    const region = screen.getByLabelText(en.recentOrders.title);
    expect(region).toHaveAttribute("aria-busy", "true");
  });
});
