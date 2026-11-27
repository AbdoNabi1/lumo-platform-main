import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ar } from "@/messages/ar";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  fetchCustomerExportPage: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/api/customers", () => ({ fetchCustomerExportPage: mocks.fetchCustomerExportPage }));

const { GET } = await import("./route");

const request = (query: string) =>
  new NextRequest(`http://localhost:3001/customers/export?${query}`, {
    headers: { host: "localhost:3001" },
  });

const exportRow = {
  id: "c-1",
  name: "=SUM(1)",
  email: "nour@example.com",
  phone: "+201001234567",
  language: "ar",
  emailMarketing: true,
  smsMarketing: false,
  tags: ["VIP"],
  note: null,
  isGuest: false,
  address: { line1: "1 Nile St", city: "Cairo", postalCode: "11511", country: "EG" },
};
const page = (items: unknown[], next: string | null = null) => ({
  outcome: "ok",
  data: { items, pageInfo: { hasNextPage: next !== null, endCursor: next } },
});
const location = (response: Response) => response.headers.get("location") ?? "";

describe("GET /customers/export", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.resetAllMocks();
    mocks.cookies.mockResolvedValue({ get: () => undefined });
  });

  it("answers customers_export.csv: BOM, no-store, guarded names, phone-shaped values untouched", async () => {
    mocks.fetchCustomerExportPage.mockResolvedValue(page([exportRow]));

    const response = await GET(request("scope=all"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="customers_export.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    // Response.text() strips a BOM when decoding, so read the raw bytes: EF BB BF.
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = await response.text();
    expect(body.startsWith("Name,Email,Phone,Language,")).toBe(true);
    expect(body).toContain("\r\n'=SUM(1),nour@example.com,+201001234567,ar,Yes,No,VIP,,");
    expect(mocks.fetchCustomerExportPage).toHaveBeenCalledWith({ first: 100 });
  });

  it("writes the Arabic header row when the admin's language is Arabic", async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "ar" }) });
    mocks.fetchCustomerExportPage.mockResolvedValue(page([]));

    const response = await GET(request("scope=all"));

    const body = await response.text();
    expect(body.startsWith(`${ar.customersExport.columns.name},`)).toBe(true);
  });

  it("scope=search pages with the search term", async () => {
    mocks.fetchCustomerExportPage.mockResolvedValue(page([exportRow]));

    await GET(request("scope=search&q=nour"));

    expect(mocks.fetchCustomerExportPage).toHaveBeenCalledWith({ first: 100, search: "nour" });
  });

  it("pages through every page with the cursor", async () => {
    mocks.fetchCustomerExportPage
      .mockResolvedValueOnce(page([exportRow], "cur-1"))
      .mockResolvedValueOnce(page([{ ...exportRow, id: "c-2", name: "Mona" }]));

    const response = await GET(request("scope=all"));

    expect(mocks.fetchCustomerExportPage).toHaveBeenNthCalledWith(2, {
      first: 100,
      after: "cur-1",
    });
    expect((await response.text()).split("\r\n")).toHaveLength(4);
  });

  it("sends a malformed request back to the list instead of a file", async () => {
    const response = await GET(request("scope=everything"));

    expect(response.status).toBe(303);
    expect(new URL(location(response)).pathname).toBe("/customers");
    expect(location(response)).toContain("exportError=failed");
    expect(mocks.fetchCustomerExportPage).not.toHaveBeenCalled();
  });

  it("a failed page redirects with exportError=failed, never a partial file", async () => {
    mocks.fetchCustomerExportPage
      .mockResolvedValueOnce(page([exportRow], "c"))
      .mockResolvedValueOnce({ outcome: "error", message: "boom" });

    const response = await GET(request("scope=all"));

    expect(response.status).toBe(303);
    expect(location(response)).toBe("http://localhost:3001/customers?exportError=failed");
    expect(response.headers.get("content-disposition")).toBeNull();
  });

  it("a viewer (the API answers 403) is sent back with exportError=failed", async () => {
    mocks.fetchCustomerExportPage.mockResolvedValue({ outcome: "unauthorized" });

    const response = await GET(request("scope=all"));

    expect(response.status).toBe(303);
    expect(location(response)).toContain("/customers?exportError=failed");
  });

  it("more than 5,000 customers redirects with exportError=too_many", async () => {
    mocks.fetchCustomerExportPage.mockResolvedValue(
      page(
        Array.from({ length: 100 }, () => exportRow),
        "c",
      ),
    );

    const response = await GET(request("scope=all"));

    expect(response.status).toBe(303);
    expect(location(response)).toContain("exportError=too_many");
    expect(mocks.fetchCustomerExportPage).toHaveBeenCalledTimes(51);
  });
});
