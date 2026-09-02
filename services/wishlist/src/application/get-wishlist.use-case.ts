import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Wishlist } from "../domain/wishlist";
import type { WishlistRepository } from "../domain/wishlist-repository";
import type { WishlistIdInput } from "./wishlist.use-cases";

export interface GetWishlistDeps {
  readonly wishlists: WishlistRepository;
}

/** Fetches a single wishlist by id. */
export class GetWishlist implements UseCase<WishlistIdInput, Wishlist, DomainError> {
  private readonly deps: GetWishlistDeps;

  constructor(deps: GetWishlistDeps) {
    this.deps = deps;
  }

  async execute(input: WishlistIdInput): Promise<Result<Wishlist, DomainError>> {
    const wishlist = await this.deps.wishlists.findById(input.wishlistId);
    return wishlist === null ? err(new NotFoundError("Wishlist not found")) : ok(wishlist);
  }
}
