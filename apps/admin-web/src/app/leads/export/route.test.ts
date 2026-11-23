import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { LeadDto } from "@/lib/api/leads";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  fetchLeadExportRows: vi.fn(),
  storeSettingsOrDefaults: vi.fn(),
  readSession: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/api/leads", () => ({ fetchLeadExportRows: mocks.fetchLeadExportRows }));
vi.mock("@/lib/api/store-settings", () => ({
  storeSettingsOrDefaults: mocks.storeSettingsOrDefaults,
}));
vi.mock("@/lib/auth/session", () => ({
  readSession: mocks.readSession,
  highestRole: (roles: readonly string[]) =>
    (["admin", "operator", "viewer"] as const).find((role) => roles.includes(role)),
}));

const { GET } = await import("./route");

const request = (query = "") =>
  new NextRequest(`http://localhost:3001/leads/export${query === "" ? "" : `?${query}`}`, {
    headers: { host: "localhost:3001" },
  });

function lead(id: string, name: string): LeadDto {
  return {
    id,
    formId: "form-1",
    name,
    phone: "+201001234567",
    phoneE164: "+201001234567",
    email: null,
    message: null,
    status: "new",
    trackingStatus: "pending",
    eventId: `lead_${id}`,
    createdAt: "2026-11-22T10:05:00.000Z",
    pageUrl: null,
    referrer: null,
  };
}

const okPage = (items: LeadDto[], endCursor: string | null) => ({
  outcome: "ok",
  items,
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
});

beforeEach(() => {
  expect.hasAssertions();
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => undefined });
  mocks.storeSettingsOrDefaults.mockResolvedValue({ timezone: "Africa/Cairo" });
  mocks.readSession.mockResolvedValue({ roles: ["operator"] });
});

describe("GET /leads/export", () => {
  it("sends a viewer back to the list with exportError=forbidden and reads nothing", async () => {
    mocks.readSession.mockResolvedValue({ roles: ["viewer"] });

    const response = await GET(request());

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/leads");
    expect(location.searchParams.get("exportError")).toBe("forbidden");
    expect(mocks.fetchLeadExportRows).not.toHaveBeenCalled();
  });

  it("treats a missing session as forbidden", async () => {
    mocks.readSession.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.headers.get("location")).toContain("exportError=forbidden");
  });

  it("answers an operator a BOM CSV with both pages, CRLF, named for the shop's day", async () => {
    mocks.fetchLeadExportRows
      .mockResolvedValueOnce(okPage([lead("l1", "منى")], "c1"))
      .mockResolvedValueOnce(okPage([lead("l2", '=HYPERLINK("x")')], null));

    const response = await GET(request("status=new"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="leads_export_\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = await response.text();
    const lines = body.split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(",منى,");
    expect(lines[2]).toContain(',"\'=HYPERLINK(""x"")",');
    expect(mocks.fetchLeadExportRows).toHaveBeenNthCalledWith(1, { status: "new" });
    expect(mocks.fetchLeadExportRows).toHaveBeenNthCalledWith(2, { status: "new", after: "c1" });
  });

  it("sends no status when the filter is absent, empty or 'all'", async () => {
    mocks.fetchLeadExportRows.mockResolvedValue(okPage([], null));
    await GET(request());
    await GET(request("status="));
    await GET(request("status=all"));
    for (const call of mocks.fetchLeadExportRows.mock.calls) expect(call[0]).toEqual({});
  });

  it("sends an unknown status back with exportError=invalid", async () => {
    const response = await GET(request("status=won"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("exportError=invalid");
    expect(mocks.fetchLeadExportRows).not.toHaveBeenCalled();
  });

  it("sends a failed read back with exportError=failed, a refused one with forbidden", async () => {
    mocks.fetchLeadExportRows.mockResolvedValueOnce({ outcome: "error", message: "x" });
    expect((await GET(request())).headers.get("location")).toContain("exportError=failed");

    mocks.fetchLeadExportRows.mockResolvedValueOnce({ outcome: "unauthorized" });
    expect((await GET(request())).headers.get("location")).toContain("exportError=forbidden");
  });

  it("refuses more than 5,000 rows with exportError=too_many instead of a partial file", async () => {
    mocks.fetchLeadExportRows.mockImplementation(() =>
      Promise.resolve(
        okPage(
          Array.from({ length: 250 }, (_, i) => lead(`l${i}`, "x")),
          "more",
        ),
      ),
    );
    const response = await GET(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("exportError=too_many");
    expect(mocks.fetchLeadExportRows).toHaveBeenCalledTimes(21);
  });
});
