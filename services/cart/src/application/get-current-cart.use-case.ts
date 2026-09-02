import type { UseCase } from "@platform/application";
import { Guard } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Cart } from "../domain/cart";
import type { CartRepository } from "../domain/cart-repository";

export interface GetCurrentCartInput {
  readonly sessionRef: string;
}

export interface GetCurrentCartDeps {
  readonly carts: CartRepository;
}

/**
 * Reads the caller's own current (active) cart for a session — guest or customer alike
 * (Phase 17.1). Unlike {@link GetCart}, `null` is a valid, successful outcome ("no cart yet"),
 * never a `NotFoundError`: a session with no cart is the ordinary first-visit state, not an error.
 */
export class GetCurrentCart implements UseCase<GetCurrentCartInput, Cart | null, DomainError> {
  private readonly deps: GetCurrentCartDeps;

  constructor(deps: GetCurrentCartDeps) {
    this.deps = deps;
  }

  async execute(input: GetCurrentCartInput): Promise<Result<Cart | null, DomainError>> {
    const sessionRef = Guard.againstEmpty(input.sessionRef, "sessionRef");
    if (!sessionRef.ok) return err(sessionRef.error);

    const cart = await this.deps.carts.findBySessionRef(input.sessionRef);
    return ok(cart);
  }
}
