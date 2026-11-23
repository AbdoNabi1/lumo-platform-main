import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLeadExportRowsResult, LeadDto } from "@/lib/api/leads";
import { collectLeadExportRows } from "./leads-export";

beforeEach(() => {
  expect.hasAssertions();
});

function row(id: string): LeadDto {
  return {
    id,
    formId: "f",
    name: id,
    phone: "+201001234567",
    phoneE164: "+201001234567",
    email: null,
    message: null,
    status: "new",
    trackingStatus: "pending",
    eventId: `lead_${id}`,
    createdAt: "2026-11-22T10:00:00.000Z",
    pageUrl: null,
    referrer: null,
  };
}

const page = (ids: string[], next: string | null): FetchLeadExportRowsResult => ({
  outcome: "ok",
  items: ids.map(row),
  pageInfo: { hasNextPage: next !== null, endCursor: next },
});

describe("collectLeadExportRows", () => {
  it("follows the cursor and concatenates the pages", async () => {
    const fetchPage = vi
      .fn<(q: { after?: string; status?: string }) => Promise<FetchLeadExportRowsResult>>()
      .mockResolvedValueOnce(page(["a", "b"], "c1"))
      .mockResolvedValueOnce(page(["c"], null));

    const result = await collectLeadExportRows(fetchPage, { status: "new" });

    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") expect(result.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, { status: "new" });
    expect(fetchPage).toHaveBeenNthCalledWith(2, { status: "new", after: "c1" });
  });

  it("refuses more rows than the cap", async () => {
    const fetchPage = vi.fn().mockResolvedValue(page(["a", "b", "c"], "next"));
    const result = await collectLeadExportRows(fetchPage, {}, 5);
    expect(result).toEqual({ outcome: "too_many" });
  });

  it("passes a failure or an unauthorized read through", async () => {
    expect(
      await collectLeadExportRows(vi.fn().mockResolvedValue({ outcome: "unauthorized" }), {}),
    ).toEqual({ outcome: "unauthorized" });
    expect(
      await collectLeadExportRows(
        vi.fn().mockResolvedValue({ outcome: "error", message: "x" }),
        {},
      ),
    ).toEqual({ outcome: "error" });
  });
});
