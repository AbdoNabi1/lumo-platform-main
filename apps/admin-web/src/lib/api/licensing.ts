import { currentTenantRef, getAdminApi } from "./client";

/**
 * Licensing usage counters (T3.5) — `GET /usage-counters` (`apps/admin/src/http/
 * licensing-routes.ts`, `licensing:usage:read`) delegates through `LicensingAdminController.
 * getUsageCounter` (`apps/admin/src/interfaces/licensing.admin-controller.ts`) to
 * `LicensingController.getUsageCounter` (`services/licensing/src/interfaces/
 * licensing.controller.ts`), which calls `GetUsageCounter.execute`
 * (`services/licensing/src/application/licensing.use-cases.ts`). That use case always resolves
 * `ok({ amount: 0, unit: "" })` for a resource with no counter on file yet — there is no "not
 * found" state to report for an individual resource, only "not metered yet".
 *
 * Unlike every other admin-web fetch module, this endpoint is scoped to exactly **one** resource
 * per call (`querystring: { tenantRef, resource }`) and Licensing exposes no list-all-counters
 * endpoint. To render a table instead of a single figure, `fetchUsageCounters` fans out one
 * request per resource in the canonical registry (`packages/usage/src/usage-resource.ts`'s
 * `USAGE_RESOURCES`) — mirrored below as a literal list rather than adding a new workspace
 * dependency on `@platform/usage` from a Next.js app, the same choice `customer-360.ts`'s
 * `CUSTOMER_360_IDENTIFIER_TYPES` makes for its own backend enum. `tenantRef` reuses
 * `client.ts`'s `currentTenantRef()` — the same tenant id already sent as the `x-tenant-id`
 * header on every request. Per the T3.5 brief: this route is genuinely tenant-scoped by that
 * header, unlike Tenancy's `Workspace` or Licensing's `Plan`/`Subscription`, which is why the
 * Settings page can render it live while that other half of the "Workspace & billing" card stays
 * an explicit unavailable state (see `app/settings/page.tsx`'s doc comment).
 */

/** Mirrors `packages/usage/src/usage-resource.ts`'s `USAGE_RESOURCES` — the canonical, documented
 * set of billable/metered resources (ADR-0018 addendum §I). Not fabricated: every key here is a
 * real, registered resource in the Usage Registry, queried one at a time because the backend
 * offers no bulk read. */
export const LICENSING_USAGE_RESOURCES = [
  "AI_TOKEN",
  "EMAIL",
  "SMS",
  "API_REQUEST",
  "STORAGE",
  "BANDWIDTH",
  "MEDIA",
  "PRODUCT",
  "ORDER",
  "IMPORT",
  "EXPORT",
  "SEARCH",
  "RECOMMENDATION",
  "AUTOMATION",
  "WORKFLOW",
  "IMAGE_RENDER",
  "VIDEO_RENDER",
  "MARKETPLACE_INSTALL",
] as const;

export interface UsageCounterDto {
  readonly resource: string;
  readonly amount: number;
  readonly unit: string;
}

interface UsageCounterOutput {
  readonly amount: number;
  readonly unit: string;
}

function isUsageCounterOutput(value: unknown): value is UsageCounterOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { amount?: unknown }).amount === "number" &&
    typeof (value as { unit?: unknown }).unit === "string"
  );
}

export type FetchUsageCountersResult =
  | { readonly outcome: "ok"; readonly counters: readonly UsageCounterDto[] }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * Fetches the current tenant's usage across every registered resource, one `GET /usage-counters`
 * call per resource in {@link LICENSING_USAGE_RESOURCES}. If any call is unauthorized, the whole
 * result is `"unauthorized"` (the session/token is bad for all of them, not just one). If any
 * call fails outright, the whole result is `"error"` — a partial table would misrepresent real
 * usage as zero, which `docs/plans/README.md` rule #4 forbids.
 */
export async function fetchUsageCounters(): Promise<FetchUsageCountersResult> {
  const tenantRef = currentTenantRef();

  const settled = await Promise.all(
    LICENSING_USAGE_RESOURCES.map(async (resource) => {
      const params = new URLSearchParams({ tenantRef, resource });
      const result = await getAdminApi(
        `/api/v1/usage-counters?${params.toString()}`,
        isUsageCounterOutput,
      );
      return { resource, result };
    }),
  );

  for (const { result } of settled) {
    if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  }

  const counters: UsageCounterDto[] = [];
  for (const { resource, result } of settled) {
    if (result.outcome === "ok") {
      counters.push({ resource, amount: result.data.amount, unit: result.data.unit });
      continue;
    }
    if (result.outcome === "unauthorized") {
      // Already returned above — kept for exhaustiveness so a future outcome isn't dropped silently.
      return { outcome: "unauthorized" };
    }
    if (result.outcome === "not_found") {
      return {
        outcome: "error",
        message: `Usage counters: unexpected not-found response for resource "${resource}"`,
      };
    }
    return { outcome: "error", message: result.message };
  }
  return { outcome: "ok", counters };
}
