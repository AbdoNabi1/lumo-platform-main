import type { SalesAnalyticsDto, SalesRangeDto } from "@/lib/api/sales-analytics";

/** Builds a day-by-day range (oldest first) from `[sales, orders]` pairs starting at `from`. */
export function rangeOf(
  from: string,
  days: readonly (readonly [number, number])[],
  otherCurrencyOrders = 0,
): SalesRangeDto {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const daily = days.map(([salesMinor, orders], index) => ({
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    salesMinor,
    orders,
  }));
  const totalSalesMinor = daily.reduce((sum, day) => sum + day.salesMinor, 0);
  const ordersCount = daily.reduce((sum, day) => sum + day.orders, 0);
  return {
    totalSalesMinor,
    ordersCount,
    averageOrderValueMinor: ordersCount === 0 ? 0 : Math.round(totalSalesMinor / ordersCount),
    daily,
    otherCurrencyOrders,
  };
}

/** A report for 2026-10-06 .. 2026-10-12 against the week before it; override any part. */
export function salesReport(overrides: Partial<SalesAnalyticsDto> = {}): SalesAnalyticsDto {
  return {
    current: {
      ...rangeOf("2026-10-06", [
        [0, 0],
        [10_000, 2],
        [0, 0],
        [5_000, 1],
        [0, 0],
        [20_000, 3],
        [15_000, 2],
      ]),
      ordersToFulfill: 4,
      topProducts: [
        {
          productRef: "p-1",
          variantRef: "v-1",
          name: "Linen shirt",
          variantTitle: "Large / Blue",
          quantity: 5,
          salesMinor: 30_000,
          imageUrl: "https://media.example/shirt.jpg",
        },
        {
          productRef: "p-2",
          variantRef: null,
          name: "Canvas tote",
          variantTitle: null,
          quantity: 3,
          salesMinor: 20_000,
          imageUrl: null,
        },
      ],
    },
    previous: rangeOf("2026-09-29", [
      [0, 0],
      [0, 0],
      [20_000, 2],
      [0, 0],
      [10_000, 1],
      [0, 0],
      [0, 0],
    ]),
    currency: "EGP",
    timezone: "Africa/Cairo",
    range: { from: "2026-10-06", to: "2026-10-13" },
    previousRange: { from: "2026-09-29", to: "2026-10-06" },
    ...overrides,
  };
}

/** A report for a shop with no orders at all: every figure is a real zero. */
export function emptyReport(): SalesAnalyticsDto {
  const zeros = Array.from({ length: 7 }, () => [0, 0] as const);
  return salesReport({
    current: {
      ...rangeOf("2026-10-06", zeros),
      ordersToFulfill: 0,
      topProducts: [],
    },
    previous: rangeOf("2026-09-29", zeros),
  });
}
