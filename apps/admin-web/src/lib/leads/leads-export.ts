import type { FetchLeadExportRowsResult, LeadDto, LeadStatus } from "@/lib/api/leads";
import { EXPORT_ROW_CAP } from "@/lib/orders/orders-export";

/** More than the cap's pages of 250 can never be needed (the cap is checked after every page). */
const MAX_EXPORT_REQUESTS = 30;

export type CollectedLeadExport =
  | { readonly outcome: "ok"; readonly rows: readonly LeadDto[] }
  | { readonly outcome: "too_many" | "error" | "unauthorized" };

/** Reads every page of the export (the API pages 250 at a time), refusing to pass `cap` rows. */
export async function collectLeadExportRows(
  fetchPage: (query: {
    readonly after?: string;
    readonly status?: LeadStatus;
  }) => Promise<FetchLeadExportRowsResult>,
  filter: { readonly status?: LeadStatus },
  cap: number = EXPORT_ROW_CAP,
): Promise<CollectedLeadExport> {
  const rows: LeadDto[] = [];
  let after: string | undefined;
  for (let request = 0; request < MAX_EXPORT_REQUESTS; request += 1) {
    const page = await fetchPage({ ...filter, ...(after === undefined ? {} : { after }) });
    if (page.outcome !== "ok") return { outcome: page.outcome };
    rows.push(...page.items);
    if (rows.length > cap) return { outcome: "too_many" };
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) {
      return { outcome: "ok", rows };
    }
    after = page.pageInfo.endCursor;
  }
  return { outcome: "too_many" };
}
