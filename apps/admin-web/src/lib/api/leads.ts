import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";
import { isLeadStatus, type LeadStatus } from "@/lib/leads/lead-status";

export type { LeadStatus } from "@/lib/leads/lead-status";

/**
 * The Leads inbox API (`apps/admin/src/http/leads-routes.ts`): list/get (`leads:read`), status
 * change (`leads:update`, idempotent) and the export read (`leads:export`). Every route answers the
 * same explicit `LeadDto`, so the write response is typed too.
 */

export interface LeadDto {
  readonly id: string;
  readonly formId: string;
  readonly name: string;
  /** As the visitor typed it (trimmed). */
  readonly phone: string;
  readonly phoneE164: string;
  readonly email: string | null;
  readonly message: string | null;
  readonly status: LeadStatus;
  readonly trackingStatus: string;
  readonly eventId: string;
  readonly createdAt: string;
  readonly pageUrl: string | null;
  readonly referrer: string | null;
}

export interface LeadsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface LeadsPageDto {
  readonly items: readonly LeadDto[];
  readonly pageInfo: LeadsPageInfo;
}

function isLeadDto(value: unknown): value is LeadDto {
  if (typeof value !== "object" || value === null) return false;
  const lead = value as { id?: unknown; status?: unknown; name?: unknown };
  return typeof lead.id === "string" && typeof lead.name === "string" && isLeadStatus(lead.status);
}

function isLeadsPageDto(value: unknown): value is LeadsPageDto {
  if (typeof value !== "object" || value === null) return false;
  const page = value as { items?: unknown; pageInfo?: unknown };
  return (
    Array.isArray(page.items) &&
    page.items.every(isLeadDto) &&
    typeof page.pageInfo === "object" &&
    page.pageInfo !== null
  );
}

export type FetchLeadsPageResult =
  | { readonly outcome: "ok"; readonly items: readonly LeadDto[]; readonly pageInfo: LeadsPageInfo }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /leads` (`leads:read`): cursor pages, optional `status` filter and `search` (name, phone, email; ≤100 chars). */
export async function fetchLeadsPage(query: {
  readonly first?: number;
  readonly after?: string;
  readonly status?: LeadStatus;
  readonly search?: string;
}): Promise<FetchLeadsPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  if (query.status !== undefined) params.set("status", query.status);
  if (query.search !== undefined) params.set("search", query.search);
  const queryString = params.toString();

  const result = await getAdminApi(
    queryString.length > 0 ? `/api/v1/leads?${queryString}` : "/api/v1/leads",
    isLeadsPageDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

export type FetchLeadResult =
  | { readonly outcome: "ok"; readonly lead: LeadDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /leads/:leadId` (`leads:read`). */
export async function fetchLead(leadId: string): Promise<FetchLeadResult> {
  const result = await getAdminApi(`/api/v1/leads/${encodeURIComponent(leadId)}`, isLeadDto);
  if (result.outcome === "ok") return { outcome: "ok", lead: result.data };
  return result;
}

export type FetchLeadExportRowsResult =
  | { readonly outcome: "ok"; readonly items: readonly LeadDto[]; readonly pageInfo: LeadsPageInfo }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /leads/export-rows` (`leads:export`): one cursor page (the API fixes it at 250 rows; it takes
 * no `first`). Only `after` and `status` are sent — the route has no search parameter.
 */
export async function fetchLeadExportRows(query: {
  readonly after?: string;
  readonly status?: LeadStatus;
}): Promise<FetchLeadExportRowsResult> {
  const params = new URLSearchParams();
  if (query.after !== undefined) params.set("after", query.after);
  if (query.status !== undefined) params.set("status", query.status);
  const queryString = params.toString();

  const result = await getAdminApi(
    queryString.length > 0
      ? `/api/v1/leads/export-rows?${queryString}`
      : "/api/v1/leads/export-rows",
    isLeadsPageDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

/**
 * `POST /leads/:leadId/status` (`leads:update`, `idempotent: true`): move a lead to any status; the
 * same status again is a no-op success. Pass one fresh key per user-initiated submit.
 */
export function changeLeadStatus(
  leadId: string,
  status: LeadStatus,
  idempotencyKey: string,
): Promise<MutationResult<LeadDto>> {
  return mutateAdminApi(
    `/api/v1/leads/${encodeURIComponent(leadId)}/status`,
    { method: "POST", body: { status }, idempotencyKey },
    isLeadDto,
  );
}
