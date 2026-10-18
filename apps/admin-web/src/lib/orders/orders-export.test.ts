import { describe, expect, it, vi } from "vitest";
import type { FetchOrderExportRowsResult, OrderExportRowDto } from "@/lib/api/orders";
import { collectExportRows, MAX_EXPORT_REQUESTS, parseExportRequest } from "./orders-export";

const params = (values: Record<string, string>) => new URLSearchParams(values);
const TZ = "Asia/Riyadh";

describe("parseExportRequest (Shopify's five export scopes)", () => {
  it("current page: the list's own view, search, status and cursor, one page of 50", () => {
    expect(
      parseExportRequest(
        params({
          scope: "current_page",
          view: "unpaid",
          q: "mona",
          status: "placed",
          after: "c-1",
        }),
        TZ,
      ),
    ).toEqual({
      singlePage: true,
      query: { view: "unpaid", search: "mona", status: "placed", after: "c-1", first: 50 },
    });
  });

  it("all orders: every view, every page", () => {
    expect(parseExportRequest(params({ scope: "all", view: "unpaid", q: "mona" }), TZ)).toEqual({
      singlePage: false,
      query: { view: "all" },
    });
  });

  it("selected: up to 50 ids, deduped; more is refused", () => {
    expect(parseExportRequest(params({ scope: "selected", ids: "a,b,a" }), TZ)).toEqual({
      singlePage: true,
      query: { view: "all", ids: ["a", "b"], first: 2 },
    });
    const many = Array.from({ length: 51 }, (_, i) => `o-${i}`).join(",");
    expect(parseExportRequest(params({ scope: "selected", ids: many }), TZ)).toBeNull();
  });

  it("matching: the search and filters, every page", () => {
    expect(parseExportRequest(params({ scope: "matching", view: "open", q: "mona" }), TZ)).toEqual({
      singlePage: false,
      query: { view: "open", search: "mona", status: undefined },
    });
  });

  it("by date: whole shop-local days, the end day included", () => {
    expect(
      parseExportRequest(params({ scope: "dates", from: "2026-10-01", to: "2026-10-31" }), TZ),
    ).toEqual({
      singlePage: false,
      query: {
        view: "all",
        createdFrom: "2026-09-30T21:00:00.000Z",
        createdTo: "2026-10-31T21:00:00.000Z",
      },
    });
  });

  it("refuses reversed or invalid dates and an unknown scope", () => {
    expect(
      parseExportRequest(params({ scope: "dates", from: "2026-10-31", to: "2026-10-01" }), TZ),
    ).toBeNull();
    expect(
      parseExportRequest(params({ scope: "dates", from: "2026-02-30", to: "2026-03-01" }), TZ),
    ).toBeNull();
    expect(parseExportRequest(params({ scope: "everything" }), TZ)).toBeNull();
    expect(parseExportRequest(params({}), TZ)).toBeNull();
  });
});

const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ orderId: `o-${i}` }) as OrderExportRowDto);
const ok = (count: number, next: string | null): FetchOrderExportRowsResult => ({
  outcome: "ok",
  items: rows(count),
  pageInfo: { hasNextPage: next !== null, endCursor: next },
});

describe("collectExportRows", () => {
  it("pages 250 at a time, following the cursor, until the last page", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(ok(250, "c-1"))
      .mockResolvedValueOnce(ok(10, null));
    const result = await collectExportRows(fetchPage, {
      singlePage: false,
      query: { view: "all" },
    });
    expect(result.outcome === "ok" && result.rows).toHaveLength(260);
    expect(fetchPage).toHaveBeenNthCalledWith(1, { view: "all", first: 250 });
    expect(fetchPage).toHaveBeenNthCalledWith(2, { view: "all", first: 250, after: "c-1" });
  });

  it("reads one page only for the current page or a selection", async () => {
    const fetchPage = vi.fn().mockResolvedValue(ok(50, "c-1"));
    const result = await collectExportRows(fetchPage, {
      singlePage: true,
      query: { view: "all", first: 50 },
    });
    expect(result.outcome === "ok" && result.rows).toHaveLength(50);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("stops with too_many past the cap rather than writing a cut-off file", async () => {
    const fetchPage = vi.fn().mockResolvedValue(ok(250, "c"));
    expect(
      (await collectExportRows(fetchPage, { singlePage: false, query: {} }, 500)).outcome,
    ).toBe("too_many");
  });

  it("stops with too_many when pages never end (a scan that keeps answering short pages)", async () => {
    const fetchPage = vi.fn().mockResolvedValue(ok(0, "c"));
    expect((await collectExportRows(fetchPage, { singlePage: false, query: {} })).outcome).toBe(
      "too_many",
    );
    expect(fetchPage).toHaveBeenCalledTimes(MAX_EXPORT_REQUESTS);
  });

  it("passes a failed or refused read through", async () => {
    expect(
      (
        await collectExportRows(vi.fn().mockResolvedValue({ outcome: "error", message: "x" }), {
          singlePage: false,
          query: {},
        })
      ).outcome,
    ).toBe("error");
    expect(
      (
        await collectExportRows(vi.fn().mockResolvedValue({ outcome: "unauthorized" }), {
          singlePage: false,
          query: {},
        })
      ).outcome,
    ).toBe("unauthorized");
  });
});
