import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Wishlist } from "../domain/wishlist";
import type { WishlistRepository } from "../domain/wishlist-repository";

export interface GetWishlistByCustomerInput {
  readonly customerRef: string;
}

export interface GetWishlistByCustomerDeps {
  readonly wishlists: WishlistRepository;
}

/** Fetches the one wishlist a customer owns (`@@unique([tenantId, customerRef])` — at most one). */
export class GetWishlistByCustomer
  implements UseCase<GetWishlistByCustomerInput, Wishlist, DomainError>
{
  private readonly deps: GetWishlistByCustomerDeps;

  constructor(deps: GetWishlistByCustomerDeps) {
    this.deps = deps;
  }

  async execute(input: GetWishlistByCustomerInput): Promise<Result<Wishlist, DomainError>> {
    const wishlist = await this.deps.wishlists.findByCustomerRef(input.customerRef);
    return wishlist === null ? err(new NotFoundError("Wishlist not found")) : ok(wishlist);
  }
}
