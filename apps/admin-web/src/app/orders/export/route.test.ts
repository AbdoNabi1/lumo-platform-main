import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  fetchOrderExportRows: vi.fn(),
  storeSettingsOrDefaults: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/api/orders", () => ({ fetchOrderExportRows: mocks.fetchOrderExportRows }));
vi.mock("@/lib/api/store-settings", () => ({
  storeSettingsOrDefaults: mocks.storeSettingsOrDefaults,
}));

const { GET } = await import("./route");

const request = (query: string) =>
  new NextRequest(`http://localhost:3001/orders/export?${query}`, {
    headers: { host: "localhost:3001" },
  });

const exportRow = {
  orderId: "o-1",
  orderNumber: "1001",
  createdAt: "2026-10-18T09:05:00.000Z",
  customerName: "=HYPERLINK(1)",
  email: null,
  phone: "+201012345678",
  line1: "1 Nile St",
  line2: null,
  city: "Cairo",
  province: null,
  country: "EG",
  items: [],
  itemCount: 0,
  subtotalMinor: 0,
  shippingMinor: 0,
  discountMinor: 0,
  totalMinor: 0,
  codAmountMinor: 0,
  currency: "EGP",
  paymentStatus: "pending",
  paymentProvider: null,
  fulfillmentStatus: "unfulfilled",
  shippingMethod: null,
  tags: [],
  note: null,
};

describe("GET /orders/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({ get: () => undefined });
    mocks.storeSettingsOrDefaults.mockResolvedValue({ timezone: "Asia/Riyadh" });
  });

  it("answers a BOM CSV attachment named for the shop's day, formula-guarded", async () => {
    mocks.fetchOrderExportRows.mockResolvedValue({
      outcome: "ok",
      items: [exportRow],
      pageInfo: { hasNextPage: false, endCursor: null },
    });

    const response = await GET(request("scope=current_page&view=all"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="orders_export_\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    // Response.text() strips a BOM when decoding, so read the raw bytes: EF BB BF.
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = await response.text();
    expect(body.startsWith("Order,Date,")).toBe(true);
    expect(body).toContain("#1001,2026-10-18 12:05,'=HYPERLINK(1),+201012345678,");
  });

  it("sends a malformed request back to the list instead of a file", async () => {
    const response = await GET(request("scope=everything"));
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/orders");
    expect(response.headers.get("location")).toContain("exportError=invalid");
    expect(mocks.fetchOrderExportRows).not.toHaveBeenCalled();
  });

  it("sends a failed read back with exportError=failed, and an oversize one with too_many", async () => {
    mocks.fetchOrderExportRows.mockResolvedValueOnce({ outcome: "error", message: "x" });
    expect((await GET(request("scope=all"))).headers.get("location")).toContain(
      "exportError=failed",
    );

    mocks.fetchOrderExportRows.mockResolvedValue({
      outcome: "ok",
      items: Array.from({ length: 250 }, () => exportRow),
      pageInfo: { hasNextPage: true, endCursor: "c" },
    });
    expect((await GET(request("scope=all"))).headers.get("location")).toContain(
      "exportError=too_many",
    );
  });
});
