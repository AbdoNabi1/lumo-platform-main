import type {
  GetWishlistByCustomer,
  GetWishlistByCustomerInput,
} from "../application/get-wishlist-by-customer.use-case";
import type { GetWishlist } from "../application/get-wishlist.use-case";
import type { ListWishlists, ListWishlistsInput } from "../application/list-wishlists.use-case";
import type {
  AddWishlistItem,
  AdvanceWishlist,
  CreateWishlist,
  CreateWishlistInput,
  MoveWishlistItemToCart,
  RemoveWishlistItem,
  ShareWishlistItem,
  WishlistIdInput,
  WishlistItemInput,
} from "../application/wishlist.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface WishlistControllerDeps {
  readonly createWishlist: CreateWishlist;
  readonly advanceWishlist: AdvanceWishlist;
  readonly addWishlistItem: AddWishlistItem;
  readonly removeWishlistItem: RemoveWishlistItem;
  readonly shareWishlistItem: ShareWishlistItem;
  readonly moveWishlistItemToCart: MoveWishlistItemToCart;
  readonly listWishlists: ListWishlists;
  readonly getWishlist: GetWishlist;
  readonly getWishlistByCustomer: GetWishlistByCustomer;
}

/** Framework-agnostic interface boundary for wishlist use-cases (no HTTP server). */
export class WishlistController {
  private readonly deps: WishlistControllerDeps;

  constructor(deps: WishlistControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateWishlistInput): Promise<ControllerResponse> {
    return present(await this.deps.createWishlist.execute(input), 201);
  }

  async advance(
    input: WishlistIdInput & { toStatus: "active" | "archived" },
  ): Promise<ControllerResponse> {
    return present(await this.deps.advanceWishlist.execute(input), 200);
  }

  async addItem(input: WishlistItemInput): Promise<ControllerResponse> {
    return present(await this.deps.addWishlistItem.execute(input), 200);
  }

  async removeItem(input: WishlistItemInput): Promise<ControllerResponse> {
    return present(await this.deps.removeWishlistItem.execute(input), 200);
  }

  async shareItem(input: WishlistItemInput): Promise<ControllerResponse> {
    return present(await this.deps.shareWishlistItem.execute(input), 200);
  }

  async moveItemToCart(input: WishlistItemInput): Promise<ControllerResponse> {
    return present(await this.deps.moveWishlistItemToCart.execute(input), 200);
  }

  async list(input: ListWishlistsInput): Promise<ControllerResponse> {
    return present(await this.deps.listWishlists.execute(input), 200);
  }

  async get(input: WishlistIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getWishlist.execute(input), 200);
  }

  async getByCustomer(input: GetWishlistByCustomerInput): Promise<ControllerResponse> {
    return present(await this.deps.getWishlistByCustomer.execute(input), 200);
  }
}
