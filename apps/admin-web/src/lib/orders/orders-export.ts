import type {
  FetchOrderExportRowsResult,
  OrderExportQuery,
  OrderExportRowDto,
} from "@/lib/api/orders";
import { ORDERS_PAGE_SIZE, parseOrderIds, parseOrderView } from "./order-views";
import { isCalendarDay, nextDay, startOfZonedDay } from "./zoned-time";

/** Synchronous export cap (spec decision 12); above it the merchant narrows the date range. */
export const EXPORT_ROW_CAP = 5000;
export const EXPORT_PAGE_SIZE = 250;
/** A guard against a view whose pages keep coming back short (the Unfulfilled scan). */
export const MAX_EXPORT_REQUESTS = 60;

export type ExportScope = "current_page" | "all" | "selected" | "matching" | "dates";

export interface ExportPlan {
  readonly query: OrderExportQuery;
  /** Current page and Selected read exactly one page. */
  readonly singlePage: boolean;
}

/** The dialog's submission → what to ask the API for; null for anything malformed. */
export function parseExportRequest(params: URLSearchParams, timeZone: string): ExportPlan | null {
  const text = (name: string) => {
    const value = params.get(name)?.trim();
    return value !== undefined && value.length > 0 ? value : undefined;
  };
  const view = parseOrderView({ view: text("view") });
  switch (params.get("scope")) {
    case "current_page":
      return {
        singlePage: true,
        query: {
          view,
          search: text("q"),
          status: text("status"),
          after: text("after"),
          first: ORDERS_PAGE_SIZE,
        },
      };
    case "all":
      return { singlePage: false, query: { view: "all" } };
    case "selected": {
      const ids = parseOrderIds(text("ids"), 50);
      return ids === null
        ? null
        : { singlePage: true, query: { view: "all", ids, first: ids.length } };
    }
    case "matching":
      return { singlePage: false, query: { view, search: text("q"), status: text("status") } };
    case "dates": {
      const from = text("from") ?? "";
      const to = text("to") ?? "";
      if (!isCalendarDay(from) || !isCalendarDay(to) || from > to) return null;
      return {
        singlePage: false,
        query: {
          view: "all",
          createdFrom: startOfZonedDay(from, timeZone).toISOString(),
          createdTo: startOfZonedDay(nextDay(to), timeZone).toISOString(),
        },
      };
    }
    default:
      return null;
  }
}

export type CollectedExport =
  | { readonly outcome: "ok"; readonly rows: readonly OrderExportRowDto[] }
  | { readonly outcome: "too_many" | "error" | "unauthorized" };

/** Reads every page of the plan (or one), refusing to go past `cap` rows or {@link MAX_EXPORT_REQUESTS} calls. */
export async function collectExportRows(
  fetchPage: (query: OrderExportQuery) => Promise<FetchOrderExportRowsResult>,
  plan: ExportPlan,
  cap: number = EXPORT_ROW_CAP,
): Promise<CollectedExport> {
  const rows: OrderExportRowDto[] = [];
  let after = plan.query.after;
  for (let request = 0; request < MAX_EXPORT_REQUESTS; request += 1) {
    const page = await fetchPage({
      ...plan.query,
      first: plan.singlePage ? (plan.query.first ?? EXPORT_PAGE_SIZE) : EXPORT_PAGE_SIZE,
      ...(after === undefined ? {} : { after }),
    });
    if (page.outcome !== "ok") return { outcome: page.outcome };
    rows.push(...page.items);
    if (rows.length > cap) return { outcome: "too_many" };
    if (plan.singlePage || !page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) {
      return { outcome: "ok", rows };
    }
    after = page.pageInfo.endCursor;
  }
  return { outcome: "too_many" };
}
