import type { CursorPage, Paginated } from "@platform/types";
import type { Customer } from "./customer";

/** A page request with an optional text filter, additive over the base {@link CursorPage} (Phase A.30 admin-web Customers screen). `search` matches name or email (case-insensitive substring). */
export interface CustomerListQuery extends CursorPage {
  readonly search?: string;
}

/**
 * Persistence port for {@link Customer}. Implemented in infrastructure. The optional `tx` scopes
 * the call to the caller's transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3): every method takes `tenantId` as an explicit per-call parameter,
 * matching `services/identity`'s own access-repositories shape (the ADR-0014 precedent) and
 * `services/catalog`'s first-converted-context shape. `Customer` does not carry `tenantId` on the
 * aggregate (unlike `User`), so `save` takes it as an explicit parameter (Option B) rather than
 * reading it off the aggregate (Option A).
 */
export interface CustomerRepository {
  save(customer: Customer, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Customer | null>;
  /** Looks up a customer by their email (the natural key) — used to enforce uniqueness. */
  findByEmail(email: string, tenantId: string, tx?: unknown): Promise<Customer | null>;
  /** Cursor page, most-recently-registered first (id is UUIDv7 — time-ordered, D-022), matching `OrderRepository.list`'s convention. */
  list(query: CustomerListQuery, tenantId: string, tx?: unknown): Promise<Paginated<Customer>>;
}
