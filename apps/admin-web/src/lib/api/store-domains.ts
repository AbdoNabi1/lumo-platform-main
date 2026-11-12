import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";
import {
  isDnsTargetDto,
  isShopDomainDto,
  NO_DNS_TARGET,
  type DnsTargetDto,
  type ShopDomainDto,
} from "@/lib/domains/model";

export type { DnsTargetDto, ShopDomainDto } from "@/lib/domains/model";

interface DomainsResponse {
  readonly items: readonly ShopDomainDto[];
  /** Optional: an older runtime sends none, read as {@link NO_DNS_TARGET}. */
  readonly dnsTarget?: DnsTargetDto;
}

function isDomainsResponse(value: unknown): value is DomainsResponse {
  if (typeof value !== "object" || value === null) return false;
  const { items, dnsTarget } = value as { items?: unknown; dnsTarget?: unknown };
  return (
    Array.isArray(items) &&
    items.every(isShopDomainDto) &&
    (dnsTarget === undefined || isDnsTargetDto(dnsTarget))
  );
}

function isIdResponse(value: unknown): value is { readonly id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export type FetchMyDomainsResult =
  | {
      readonly outcome: "ok";
      readonly domains: readonly ShopDomainDto[];
      /** The DNS record target custom domains must point at (what the verifier checks). */
      readonly dnsTarget: DnsTargetDto;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /store/domains` — the shop's platform subdomain, any custom domains, and the DNS target. */
export async function fetchMyDomains(): Promise<FetchMyDomainsResult> {
  const result = await getAdminApi("/api/v1/store/domains", isDomainsResponse);
  if (result.outcome === "ok") {
    return {
      outcome: "ok",
      domains: result.data.items,
      dnsTarget: result.data.dnsTarget ?? NO_DNS_TARGET,
    };
  }
  return result;
}

/** Adds a custom domain; it stays pending until its DNS is verified. */
export function addMyDomain(
  hostname: string,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  return mutateAdminApi(
    "/api/v1/store/domains",
    { method: "POST", body: { hostname }, idempotencyKey },
    isIdResponse,
  );
}

/** Checks that the custom domain points at the platform and marks it verified. */
export function verifyMyDomain(
  domainId: string,
  idempotencyKey: string,
): Promise<MutationResult<ShopDomainDto>> {
  return mutateAdminApi(
    `/api/v1/store/domains/${encodeURIComponent(domainId)}/verify`,
    { method: "POST", idempotencyKey },
    isShopDomainDto,
  );
}

/** Makes a verified domain the shop's primary; the previous primary is demoted. */
export function makeMyDomainPrimary(
  domainId: string,
  idempotencyKey: string,
): Promise<MutationResult<ShopDomainDto>> {
  return mutateAdminApi(
    `/api/v1/store/domains/${encodeURIComponent(domainId)}/primary`,
    { method: "POST", idempotencyKey },
    isShopDomainDto,
  );
}
