import type { UseCase } from "@platform/application";
import { Guard, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CartRepository } from "../domain/cart-repository";

export interface AssignCartCustomerInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly cartId: string;
  /** The customer this cart now belongs to. Callers MUST derive this from a validated session. */
  readonly customerRef: string;
}

export interface AssignCartCustomerOutput {
  readonly cartId: string;
  readonly customerRef: string;
  /** `true` when this call performed the promotion; `false` when the cart already belonged to this customer. */
  readonly assigned: boolean;
}

export interface AssignCartCustomerDeps {
  readonly carts: CartRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

/**
 * Promotes a guest cart to a customer's cart in place (T5.17 — login-time cart continuity, designed
 * by T5.16 §2's "guest-cart-to-customer-account relationship on login"). `Cart.assignCustomer` has
 * existed and been tested since Sprint 4.5 but had no use case wrapping it, so no transport could
 * ever reach it; this is that wrapper. No new domain logic — the aggregate's own idempotency guard
 * ("fails if already assigned") is still the authority.
 *
 * **Promotion in place, not a new cart**: the cart keeps its id, its `sessionRef` and every line, so
 * a shopper who logs in mid-shop loses nothing and no second cart is created to reconcile later.
 *
 * **Re-login is not an error.** The domain method refuses *any* second assignment, including a
 * repeat of the same customer — correct for the aggregate (it must not silently re-home a cart), but
 * wrong for a login flow, where signing in twice from the same browser is ordinary and must not fail
 * the login. So the same-customer case short-circuits to `assigned: false` *before* the domain call,
 * and only a genuine cross-customer re-assignment reaches `assignCustomer` and is refused (409).
 * That refusal is deliberate: silently re-homing one customer's cart to another account is exactly
 * the confusion this guard exists to prevent.
 */
export class AssignCartCustomer implements UseCase<
  AssignCartCustomerInput,
  AssignCartCustomerOutput,
  DomainError
> {
  private readonly deps: AssignCartCustomerDeps;

  constructor(deps: AssignCartCustomerDeps) {
    this.deps = deps;
  }

  async execute(
    input: AssignCartCustomerInput,
  ): Promise<Result<AssignCartCustomerOutput, DomainError>> {
    const customerRef = Guard.againstEmpty(input.customerRef, "customerRef");
    if (!customerRef.ok) return err(customerRef.error);

    return this.deps.unitOfWork.run<Result<AssignCartCustomerOutput, DomainError>>(async (tx) => {
      const cart = await this.deps.carts.findById(input.cartId, input.tenantId, tx);
      if (cart === null) return err(new NotFoundError("Cart not found"));

      if (cart.customerRef === input.customerRef) {
        return ok({ cartId: cart.id.toString(), customerRef: input.customerRef, assigned: false });
      }

      try {
        cart.assignCustomer(input.customerRef);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.carts.save(cart, input.tenantId, tx);
      return ok({ cartId: cart.id.toString(), customerRef: input.customerRef, assigned: true });
    });
  }
}
