import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Wishlist } from "../domain/wishlist";
import type { WishlistRepository } from "../domain/wishlist-repository";

export interface ListWishlistsDeps {
  readonly wishlists: WishlistRepository;
}

/** Cursor-paginated wishlist listing. */
export class ListWishlists implements UseCase<CursorPage, Paginated<Wishlist>, DomainError> {
  private readonly deps: ListWishlistsDeps;

  constructor(deps: ListWishlistsDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<Wishlist>, DomainError>> {
    return ok(await this.deps.wishlists.list(input));
  }
}
