import type { CustomerExportPage, CustomerExportRowDto } from "@/lib/api/customers";
import type { ApiResult } from "@/lib/api/client";

/** The API's page maximum for `GET /customers/export-rows`. */
export const CUSTOMER_EXPORT_PAGE_SIZE = 100;
/** Synchronous export cap; above it the merchant searches for a smaller group. */
export const CUSTOMER_EXPORT_ROW_CAP = 5000;
/** A guard against a read whose pages keep coming back short. */
export const MAX_CUSTOMER_EXPORT_REQUESTS = 60;

export interface CustomerExportPlan {
  readonly search?: string;
}

/**
 * The dialog's GET submission → what to ask the API for. `scope=all` is every customer;
 * `scope=search` is the list's current search (`q`), which is every customer when `q` is blank.
 * Anything else is malformed (`null`).
 */
export function parseCustomerExportRequest(params: URLSearchParams): CustomerExportPlan | null {
  const scope = params.get("scope");
  if (scope === "all") return {};
  if (scope !== "search") return null;
  const search = params.get("q")?.trim();
  return search === undefined || search.length === 0 ? {} : { search };
}

export type CollectedCustomerExport =
  | { readonly outcome: "ok"; readonly rows: readonly CustomerExportRowDto[] }
  | { readonly outcome: "too_many" | "error" };

/**
 * Reads every page of the plan, 100 at a time, refusing to go past {@link CUSTOMER_EXPORT_ROW_CAP}
 * rows or {@link MAX_CUSTOMER_EXPORT_REQUESTS} calls. Any page that fails (or promises a next page
 * without a cursor, or whose read rejects) fails the whole export — a partial file is never produced.
 */
export async function collectCustomerExportRows(
  fetchPage: (query: {
    readonly first: number;
    readonly after?: string;
    readonly search?: string;
  }) => Promise<ApiResult<CustomerExportPage>>,
  plan: CustomerExportPlan,
  cap: number = CUSTOMER_EXPORT_ROW_CAP,
): Promise<CollectedCustomerExport> {
  const rows: CustomerExportRowDto[] = [];
  let after: string | undefined;
  for (let request = 0; request < MAX_CUSTOMER_EXPORT_REQUESTS; request += 1) {
    let page: ApiResult<CustomerExportPage>;
    try {
      page = await fetchPage({
        first: CUSTOMER_EXPORT_PAGE_SIZE,
        ...(plan.search === undefined ? {} : { search: plan.search }),
        ...(after === undefined ? {} : { after }),
      });
    } catch {
      // The shared GET helper parses the body outside its network catch, so a truncated or
      // non-JSON 200 (or a failed body read) rejects; that is a failed page, never a partial file.
      return { outcome: "error" };
    }
    if (page.outcome !== "ok") return { outcome: "error" };
    rows.push(...page.data.items);
    if (rows.length > cap) return { outcome: "too_many" };
    if (!page.data.pageInfo.hasNextPage) return { outcome: "ok", rows };
    if (page.data.pageInfo.endCursor === null) return { outcome: "error" };
    after = page.data.pageInfo.endCursor;
  }
  return { outcome: "too_many" };
}
