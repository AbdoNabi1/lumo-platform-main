import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, normalizePageSize } from "@platform/repository";
import type { Paginated } from "@platform/types";
import type { Customer } from "../domain/customer";
import type { CustomerListQuery, CustomerRepository } from "../domain/customer-repository";

export interface InMemoryCustomerRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `CustomerRepository`. Persists the aggregate and writes its events to the outbox on
 * save. The email lookup scans the store (acceptable for the in-memory adapter).
 *
 * ADR-0014 (WP-10, T10.3): keyed by `(tenantId, customerId)`, not just `customerId` — `Customer`
 * carries no `tenantId` of its own, so the store must key on it explicitly or a cross-tenant leak
 * here would be invisible to every isolation test.
 */
export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly customer: Customer }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryCustomerRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(customer: Customer, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(customer.id.toString(), { tenantId, customer });
    await this.outbox.write(customer.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Customer | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.customer : null;
  }

  async findByEmail(email: string, tenantId: string): Promise<Customer | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.customer.email.value === email) {
        return entry.customer;
      }
    }
    return null;
  }

  async list(query: CustomerListQuery, tenantId: string): Promise<Paginated<Customer>> {
    const limit = normalizePageSize(query.first);
    const search = query.search?.trim().toLowerCase();
    const matches = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.customer)
      .filter(
        (customer) =>
          search === undefined ||
          search.length === 0 ||
          customer.name.toLowerCase().includes(search) ||
          customer.email.value.toLowerCase().includes(search),
      )
      .sort((a, b) => (a.id.toString() < b.id.toString() ? 1 : -1));
    const after = query.after;
    const startIndex =
      after === undefined
        ? 0
        : matches.findIndex((customer) => customer.id.toString() === after) + 1;
    const page = matches.slice(startIndex, startIndex + limit + 1);
    return buildPaginatedPage(page, limit, (customer) => customer.id.toString());
  }
}
