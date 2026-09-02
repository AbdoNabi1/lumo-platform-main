import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Cart } from "../domain/cart";
import type { CartRepository } from "../domain/cart-repository";

export interface CartLifecycleInput {
  readonly cartId: string;
}

export interface CartLifecycleOutput {
  readonly cartId: string;
  readonly status: string;
}

export interface CartLifecycleDeps {
  readonly carts: CartRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator?: IdGenerator;
  readonly clock?: Clock;
}

/** Shared base for the cart lifecycle commands (Lock/Unlock/SaveForLater/Restore/Expire/Clear): load, mutate, save. */
abstract class CartLifecycleCommand implements UseCase<
  CartLifecycleInput,
  CartLifecycleOutput,
  DomainError
> {
  protected readonly deps: CartLifecycleDeps;

  constructor(deps: CartLifecycleDeps) {
    this.deps = deps;
  }

  async execute(input: CartLifecycleInput): Promise<Result<CartLifecycleOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<CartLifecycleOutput, DomainError>>(async (tx) => {
      const cart = await this.deps.carts.findById(input.cartId, tx);
      if (cart === null) {
        return err(new NotFoundError("Cart not found"));
      }

      try {
        this.mutate(cart);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.carts.save(cart, tx);
      return ok({ cartId: cart.id.toString(), status: cart.status });
    });
  }

  protected abstract mutate(cart: Cart): void;
}

/** Locks a cart against further modification. Emits `cart.locked`. */
export class LockCart extends CartLifecycleCommand {
  protected mutate(cart: Cart): void {
    if (this.deps.idGenerator === undefined || this.deps.clock === undefined) {
      throw new Error("LockCart requires idGenerator and clock");
    }
    cart.lock(this.deps.idGenerator.generate(), this.deps.clock.now());
  }
}

/** Unlocks a previously-locked cart back to active. No dedicated integration event. */
export class UnlockCart extends CartLifecycleCommand {
  protected mutate(cart: Cart): void {
    cart.unlock();
  }
}

/** Sets an active cart aside ("save for later"). Emits `cart.saved`. */
export class SaveCartForLater extends CartLifecycleCommand {
  protected mutate(cart: Cart): void {
    if (this.deps.idGenerator === undefined || this.deps.clock === undefined) {
      throw new Error("SaveCartForLater requires idGenerator and clock");
    }
    cart.saveForLater(this.deps.idGenerator.generate(), this.deps.clock.now());
  }
}

/** Restores a saved cart back to active. No dedicated integration event. */
export class RestoreCart extends CartLifecycleCommand {
  protected mutate(cart: Cart): void {
    cart.restore();
  }
}

/** Expires a still-live cart (active/locked/saved). Emits `cart.expired`. */
export class ExpireCart extends CartLifecycleCommand {
  protected mutate(cart: Cart): void {
    if (this.deps.idGenerator === undefined || this.deps.clock === undefined) {
      throw new Error("ExpireCart requires idGenerator and clock");
    }
    cart.expire(this.deps.idGenerator.generate(), this.deps.clock.now());
  }
}

/** Clears all lines from an active cart. */
export class ClearCart extends CartLifecycleCommand {
  protected mutate(cart: Cart): void {
    cart.clear();
  }
}
