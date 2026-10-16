import type { UseCase } from "@platform/application";
import type { Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Order } from "../domain/order";
import type { OrderListQuery, OrderRepository } from "../domain/order-repository";

export interface ListOrdersInput extends OrderListQuery {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
}

export interface ListOrdersDeps {
  readonly orders: OrderRepository;
}

/** Cursor-paginated order listing, most recently placed first, with optional status/search filters — delegates straight to the repository. */
export class ListOrders implements UseCase<ListOrdersInput, Paginated<Order>, DomainError> {
  private readonly deps: ListOrdersDeps;

  constructor(deps: ListOrdersDeps) {
    this.deps = deps;
  }

  async execute(input: ListOrdersInput): Promise<Result<Paginated<Order>, DomainError>> {
    const { tenantId, ...query } = input;
    return ok(await this.deps.orders.list(query, tenantId));
  }
}
