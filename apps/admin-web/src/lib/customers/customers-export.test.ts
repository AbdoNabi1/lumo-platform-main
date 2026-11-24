import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerExportRowDto } from "@/lib/api/customers";
import {
  collectCustomerExportRows,
  CUSTOMER_EXPORT_PAGE_SIZE,
  CUSTOMER_EXPORT_ROW_CAP,
  MAX_CUSTOMER_EXPORT_REQUESTS,
  parseCustomerExportRequest,
} from "./customers-export";

const params = (values: Record<string, string>) => new URLSearchParams(values);
const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `c-${i}` }) as CustomerExportRowDto);
const ok = (count: number, next: string | null) => ({
  outcome: "ok" as const,
  data: { items: rows(count), pageInfo: { hasNextPage: next !== null, endCursor: next } },
});

beforeEach(() => {
  expect.hasAssertions();
});

describe("parseCustomerExportRequest", () => {
  it("all: no search, whatever q says", () => {
    expect(parseCustomerExportRequest(params({ scope: "all", q: "nour" }))).toEqual({});
  });

  it("search: carries the trimmed q", () => {
    expect(parseCustomerExportRequest(params({ scope: "search", q: "  nour " }))).toEqual({
      search: "nour",
    });
  });

  it("search with no q is every customer", () => {
    expect(parseCustomerExportRequest(params({ scope: "search" }))).toEqual({});
    expect(parseCustomerExportRequest(params({ scope: "search", q: "   " }))).toEqual({});
  });

  it("refuses a missing or unknown scope", () => {
    expect(parseCustomerExportRequest(params({}))).toBeNull();
    expect(parseCustomerExportRequest(params({ scope: "everything" }))).toBeNull();
    expect(parseCustomerExportRequest(params({ scope: "ALL" }))).toBeNull();
  });
});

describe("collectCustomerExportRows", () => {
  it("has the plan's limits", () => {
    expect(CUSTOMER_EXPORT_PAGE_SIZE).toBe(100);
    expect(CUSTOMER_EXPORT_ROW_CAP).toBe(5000);
    expect(MAX_CUSTOMER_EXPORT_REQUESTS).toBe(60);
  });

  it("pages 100 at a time, following the cursor, until the last page", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(ok(100, "c-1"))
      .mockResolvedValueOnce(ok(10, null));

    const result = await collectCustomerExportRows(fetchPage, { search: "nour" });

    expect(result.outcome === "ok" && result.rows).toHaveLength(110);
    expect(fetchPage).toHaveBeenNthCalledWith(1, { first: 100, search: "nour" });
    expect(fetchPage).toHaveBeenNthCalledWith(2, { first: 100, search: "nour", after: "c-1" });
  });

  it("sends no search key for the all-customers plan", async () => {
    const fetchPage = vi.fn().mockResolvedValue(ok(1, null));

    await collectCustomerExportRows(fetchPage, {});

    expect(fetchPage).toHaveBeenCalledWith({ first: 100 });
  });

  it("exactly 5000 rows is allowed", async () => {
    const fetchPage = vi.fn();
    for (let page = 0; page < 49; page += 1) fetchPage.mockResolvedValueOnce(ok(100, `c-${page}`));
    fetchPage.mockResolvedValueOnce(ok(100, null));

    const result = await collectCustomerExportRows(fetchPage, {});

    expect(result.outcome === "ok" && result.rows).toHaveLength(5000);
    expect(fetchPage).toHaveBeenCalledTimes(50);
  });

  it("5001 rows is too_many, never a cut-off file", async () => {
    const fetchPage = vi.fn();
    for (let page = 0; page < 50; page += 1) fetchPage.mockResolvedValueOnce(ok(100, `c-${page}`));
    fetchPage.mockResolvedValueOnce(ok(1, null));

    const result = await collectCustomerExportRows(fetchPage, {});

    expect(result).toEqual({ outcome: "too_many" });
  });

  it("stops after 60 requests when pages never end (short pages)", async () => {
    const fetchPage = vi.fn().mockResolvedValue(ok(0, "c"));

    const result = await collectCustomerExportRows(fetchPage, {});

    expect(result).toEqual({ outcome: "too_many" });
    expect(fetchPage).toHaveBeenCalledTimes(MAX_CUSTOMER_EXPORT_REQUESTS);
  });

  it.each([
    ["unauthorized", { outcome: "unauthorized" }],
    ["error", { outcome: "error", message: "boom" }],
    ["not_found", { outcome: "not_found" }],
  ])("a %s page fails the whole export, even after good pages", async (_name, bad) => {
    const fetchPage = vi.fn().mockResolvedValueOnce(ok(100, "c-1")).mockResolvedValueOnce(bad);

    const result = await collectCustomerExportRows(fetchPage, {});

    expect(result).toEqual({ outcome: "error" });
  });

  it("a page that promises more but gives no cursor fails instead of writing half a file", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      outcome: "ok",
      data: { items: rows(3), pageInfo: { hasNextPage: true, endCursor: null } },
    });

    expect(await collectCustomerExportRows(fetchPage, {})).toEqual({ outcome: "error" });
  });
});
