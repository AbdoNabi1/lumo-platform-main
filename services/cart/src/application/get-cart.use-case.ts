import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Cart } from "../domain/cart";
import type { CartRepository } from "../domain/cart-repository";

export interface GetCartInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly cartId: string;
}

export interface GetCartDeps {
  readonly carts: CartRepository;
}

/** Reads a single cart by id. Never mutates, never recalculates prices — the cart's stored snapshots are the answer. */
export class GetCart implements UseCase<GetCartInput, Cart, DomainError> {
  private readonly deps: GetCartDeps;

  constructor(deps: GetCartDeps) {
    this.deps = deps;
  }

  async execute(input: GetCartInput): Promise<Result<Cart, DomainError>> {
    const cart = await this.deps.carts.findById(input.cartId, input.tenantId);
    if (cart === null) {
      return err(new NotFoundError("Cart not found"));
    }
    return ok(cart);
  }
}
