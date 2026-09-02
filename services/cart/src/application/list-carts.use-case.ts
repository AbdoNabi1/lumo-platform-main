import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Cart, CartStatus } from "../domain/cart";
import type { CartRepository } from "../domain/cart-repository";

export interface ListCartsInput extends CursorPage {
  /** Filters to one status — this is the operator's abandoned-cart recovery view. */
  readonly status?: CartStatus;
}

export interface ListCartsDeps {
  readonly carts: CartRepository;
}

/** Cursor-paginated cart listing, optionally filtered to a single status. Never mutates, never recalculates prices. */
export class ListCarts implements UseCase<ListCartsInput, Paginated<Cart>, DomainError> {
  private readonly deps: ListCartsDeps;

  constructor(deps: ListCartsDeps) {
    this.deps = deps;
  }

  async execute(input: ListCartsInput): Promise<Result<Paginated<Cart>, DomainError>> {
    const { status, ...page } = input;
    return ok(await this.deps.carts.list(page, status !== undefined ? { status } : undefined));
  }
}
