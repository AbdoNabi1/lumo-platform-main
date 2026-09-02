import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { Wishlist } from "../domain/wishlist";
import type { WishlistRepository } from "../domain/wishlist-repository";
import type { CartPort } from "./ports";

export interface CreateWishlistInput {
  readonly customerRef: string;
}

export interface WishlistStatusOutput {
  readonly wishlistId: string;
  readonly status: string;
  readonly itemCount: number;
}

export interface WishlistIdInput {
  readonly wishlistId: string;
}

export interface WishlistItemInput extends WishlistIdInput {
  readonly productRef: string;
}

export interface WishlistDeps {
  readonly wishlists: WishlistRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

function toOutput(wishlist: Wishlist): WishlistStatusOutput {
  return {
    wishlistId: wishlist.id.toString(),
    status: wishlist.status.value,
    itemCount: wishlist.items.length,
  };
}

/** Creates a wishlist for a customer — one active wishlist per customer. */
export class CreateWishlist implements UseCase<
  CreateWishlistInput,
  WishlistStatusOutput,
  DomainError
> {
  private readonly deps: WishlistDeps;

  constructor(deps: WishlistDeps) {
    this.deps = deps;
  }

  async execute(input: CreateWishlistInput): Promise<Result<WishlistStatusOutput, DomainError>> {
    const customerRef = Guard.againstEmpty(input.customerRef, "customerRef");
    if (!customerRef.ok) return err(customerRef.error);

    return this.deps.unitOfWork.run<Result<WishlistStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.wishlists.findByCustomerRef(input.customerRef, tx);
      if (existing !== null) {
        return err(new ConflictError(`Customer "${input.customerRef}" already has a wishlist`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const wishlist = Wishlist.create(id, input.customerRef);
      await this.deps.wishlists.save(wishlist, tx);
      return ok(toOutput(wishlist));
    });
  }
}

/** Generic validated status transition — used for archive/reactivate. */
export class AdvanceWishlist implements UseCase<
  WishlistIdInput & { readonly toStatus: "active" | "archived" },
  WishlistStatusOutput,
  DomainError
> {
  private readonly deps: WishlistDeps;

  constructor(deps: WishlistDeps) {
    this.deps = deps;
  }

  async execute(
    input: WishlistIdInput & { readonly toStatus: "active" | "archived" },
  ): Promise<Result<WishlistStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<WishlistStatusOutput, DomainError>>(async (tx) => {
      const wishlist = await this.deps.wishlists.findById(input.wishlistId, tx);
      if (wishlist === null) return err(new NotFoundError("Wishlist not found"));

      try {
        wishlist.transition(
          input.toStatus,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.wishlists.save(wishlist, tx);
      return ok(toOutput(wishlist));
    });
  }
}

/** Adds a product to the wishlist — idempotent. */
export class AddWishlistItem implements UseCase<
  WishlistItemInput,
  WishlistStatusOutput,
  DomainError
> {
  private readonly deps: WishlistDeps;

  constructor(deps: WishlistDeps) {
    this.deps = deps;
  }

  async execute(input: WishlistItemInput): Promise<Result<WishlistStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<WishlistStatusOutput, DomainError>>(async (tx) => {
      const wishlist = await this.deps.wishlists.findById(input.wishlistId, tx);
      if (wishlist === null) return err(new NotFoundError("Wishlist not found"));

      try {
        wishlist.addItem(input.productRef, this.deps.clock.now(), this.deps.idGenerator.generate());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.wishlists.save(wishlist, tx);
      return ok(toOutput(wishlist));
    });
  }
}

/** Removes a product from the wishlist — idempotent. */
export class RemoveWishlistItem implements UseCase<
  WishlistItemInput,
  WishlistStatusOutput,
  DomainError
> {
  private readonly deps: WishlistDeps;

  constructor(deps: WishlistDeps) {
    this.deps = deps;
  }

  async execute(input: WishlistItemInput): Promise<Result<WishlistStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<WishlistStatusOutput, DomainError>>(async (tx) => {
      const wishlist = await this.deps.wishlists.findById(input.wishlistId, tx);
      if (wishlist === null) return err(new NotFoundError("Wishlist not found"));

      try {
        wishlist.removeItem(
          input.productRef,
          this.deps.clock.now(),
          this.deps.idGenerator.generate(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.wishlists.save(wishlist, tx);
      return ok(toOutput(wishlist));
    });
  }
}

export interface ShareWishlistItemOutput extends WishlistStatusOutput {
  readonly shareToken: string;
}

/** Generates (or replays) a share token for one item — idempotent. */
export class ShareWishlistItem implements UseCase<
  WishlistItemInput,
  ShareWishlistItemOutput,
  DomainError
> {
  private readonly deps: WishlistDeps;

  constructor(deps: WishlistDeps) {
    this.deps = deps;
  }

  async execute(input: WishlistItemInput): Promise<Result<ShareWishlistItemOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ShareWishlistItemOutput, DomainError>>(async (tx) => {
      const wishlist = await this.deps.wishlists.findById(input.wishlistId, tx);
      if (wishlist === null) return err(new NotFoundError("Wishlist not found"));

      let shareToken: string;
      try {
        shareToken = wishlist.shareItem(
          input.productRef,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
          this.deps.idGenerator.generate(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.wishlists.save(wishlist, tx);
      return ok({ ...toOutput(wishlist), shareToken });
    });
  }
}

export interface MoveWishlistItemToCartDeps extends WishlistDeps {
  readonly cart: CartPort;
}

/** Moves an item to the cart via `CartPort`, then removes it from the wishlist. Never mutates the cart's own aggregate directly. */
export class MoveWishlistItemToCart implements UseCase<
  WishlistItemInput,
  WishlistStatusOutput,
  DomainError
> {
  private readonly deps: MoveWishlistItemToCartDeps;

  constructor(deps: MoveWishlistItemToCartDeps) {
    this.deps = deps;
  }

  async execute(input: WishlistItemInput): Promise<Result<WishlistStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<WishlistStatusOutput, DomainError>>(async (tx) => {
      const wishlist = await this.deps.wishlists.findById(input.wishlistId, tx);
      if (wishlist === null) return err(new NotFoundError("Wishlist not found"));

      try {
        wishlist.moveToCart(
          input.productRef,
          this.deps.clock.now(),
          this.deps.idGenerator.generate(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.cart.addItem(wishlist.customerRef, input.productRef);
      await this.deps.wishlists.save(wishlist, tx);
      return ok(toOutput(wishlist));
    });
  }
}
