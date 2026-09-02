import { getAdminApi } from "./client";
import type { OrderAddressDto } from "./orders";

export interface CustomerListItemDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface CustomersPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface CustomersPageDto {
  readonly items: readonly CustomerListItemDto[];
  readonly pageInfo: CustomersPageInfo;
}

function isCustomersPageDto(value: unknown): value is CustomersPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export interface CustomersListQuery {
  readonly first?: number;
  readonly after?: string;
  readonly search?: string;
}

export type FetchCustomersPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly CustomerListItemDto[];
      readonly pageInfo: CustomersPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a filtered, cursor-paginated page of customers for the Customers list screen. */
export async function fetchCustomersPage(
  query: CustomersListQuery,
): Promise<FetchCustomersPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  if (query.search !== undefined) params.set("search", query.search);

  const result = await getAdminApi(`/api/v1/customers?${params.toString()}`, isCustomersPageDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

export interface CustomerConsentDto {
  readonly scope: string;
  readonly granted: boolean;
  readonly occurredAt: string;
}

export interface CustomerDetailDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly addresses: readonly OrderAddressDto[];
  readonly consents: readonly CustomerConsentDto[];
}

function isCustomerDetailDto(value: unknown): value is CustomerDetailDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { email?: unknown }).email === "string"
  );
}

export type FetchCustomerResult =
  | { readonly outcome: "ok"; readonly customer: CustomerDetailDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a customer by id (resolves an order's `customerRef` for the Order Detail screen, and the Customer Detail screen itself). */
export async function fetchCustomer(customerId: string): Promise<FetchCustomerResult> {
  const result = await getAdminApi(
    `/api/v1/customers/${encodeURIComponent(customerId)}`,
    isCustomerDetailDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", customer: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}
