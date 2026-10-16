import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Wishlist } from "../domain/wishlist";
import type { WishlistRepository } from "../domain/wishlist-repository";

export interface ListWishlistsInput extends CursorPage {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ListWishlistsDeps {
  readonly wishlists: WishlistRepository;
}

/** Cursor-paginated wishlist listing. */
export class ListWishlists implements UseCase<
  ListWishlistsInput,
  Paginated<Wishlist>,
  DomainError
> {
  private readonly deps: ListWishlistsDeps;

  constructor(deps: ListWishlistsDeps) {
    this.deps = deps;
  }

  async execute(input: ListWishlistsInput): Promise<Result<Paginated<Wishlist>, DomainError>> {
    const { tenantId, ...page } = input;
    return ok(await this.deps.wishlists.list(page, tenantId));
  }
}
