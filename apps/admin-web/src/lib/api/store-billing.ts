import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";
import {
  isMerchantBillingDto,
  isMerchantPlanDto,
  type MerchantBillingDto,
  type MerchantPlanDto,
} from "@/lib/billing/model";

export type { MerchantBillingDto, MerchantInvoiceDto, MerchantPlanDto } from "@/lib/billing/model";

interface PlansResponse {
  readonly items: readonly MerchantPlanDto[];
}

function isPlansResponse(value: unknown): value is PlansResponse {
  if (typeof value !== "object" || value === null) return false;
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) && items.every(isMerchantPlanDto);
}

function isIdResponse(value: unknown): value is { readonly id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

function isCheckoutResponse(value: unknown): value is { readonly checkoutUrl: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { checkoutUrl?: unknown }).checkoutUrl === "string"
  );
}

export type FetchMyBillingResult =
  | { readonly outcome: "ok"; readonly billing: MerchantBillingDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /store/billing` — the shop's plan, status, next charge, card flag and invoices. */
export async function fetchMyBilling(): Promise<FetchMyBillingResult> {
  const result = await getAdminApi("/api/v1/store/billing", isMerchantBillingDto);
  if (result.outcome === "ok") return { outcome: "ok", billing: result.data };
  return result;
}

export type FetchPublishedPlansResult =
  | { readonly outcome: "ok"; readonly plans: readonly MerchantPlanDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /store/billing/plans` — the published plans the shop can choose between. */
export async function fetchPublishedPlans(): Promise<FetchPublishedPlansResult> {
  const result = await getAdminApi("/api/v1/store/billing/plans", isPlansResponse);
  if (result.outcome === "ok") return { outcome: "ok", plans: result.data.items };
  return result;
}

/** Moves the shop's own subscription to another published plan, by plan key. */
export function changeMyPlan(
  planKey: string,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  return mutateAdminApi(
    "/api/v1/store/billing/plan",
    { method: "POST", body: { planKey }, idempotencyKey },
    isIdResponse,
  );
}

/** Starts the card checkout for one of the shop's own invoices; answers where to send the payer. */
export function payMyInvoice(
  invoiceId: string,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly checkoutUrl: string }>> {
  return mutateAdminApi(
    `/api/v1/store/billing/invoices/${encodeURIComponent(invoiceId)}/pay`,
    { method: "POST", idempotencyKey },
    isCheckoutResponse,
  );
}
