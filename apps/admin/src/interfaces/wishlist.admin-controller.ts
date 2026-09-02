import type { Principal } from "@platform/contracts";
import type { CursorPage } from "@platform/types";
import type { WishlistController } from "@platform/wishlist";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface WishlistAdminControllerDeps {
  readonly wishlist: WishlistController;
  readonly guard: AdminGuard;
}

/** Wires the Wishlist admin screen to the Wishlist context (Sprint S1). Pure delegation; every action authorizes first (RBAC seam, ADR-0007). */
export class WishlistAdminController {
  private readonly wishlist: WishlistController;
  private readonly guard: AdminGuard;

  constructor(deps: WishlistAdminControllerDeps) {
    this.wishlist = deps.wishlist;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<WishlistController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "wishlist:create");
    if (denied) return denied;
    return this.wishlist.create(input);
  }

  async advance(
    principal: Principal,
    input: Parameters<WishlistController["advance"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "wishlist:advance");
    if (denied) return denied;
    return this.wishlist.advance(input);
  }

  async addItem(
    principal: Principal,
    input: Parameters<WishlistController["addItem"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "wishlist:add-item");
    if (denied) return denied;
    return this.wishlist.addItem(input);
  }

  async removeItem(
    principal: Principal,
    input: Parameters<WishlistController["removeItem"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "wishlist:remove-item");
    if (denied) return denied;
    return this.wishlist.removeItem(input);
  }

  async shareItem(
    principal: Principal,
    input: Parameters<WishlistController["shareItem"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "wishlist:share-item");
    if (denied) return denied;
    return this.wishlist.shareItem(input);
  }

  async moveItemToCart(
    principal: Principal,
    input: Parameters<WishlistController["moveItemToCart"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "wishlist:move-item-to-cart");
    if (denied) return denied;
    return this.wishlist.moveItemToCart(input);
  }

  async list(principal: Principal, input: CursorPage): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "wishlist:read");
    if (denied) return denied;
    return this.wishlist.list(input);
  }

  async get(
    principal: Principal,
    input: Parameters<WishlistController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "wishlist:read");
    if (denied) return denied;
    return this.wishlist.get(input);
  }

  async getByCustomer(
    principal: Principal,
    input: Parameters<WishlistController["getByCustomer"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "wishlist:read");
    if (denied) return denied;
    return this.wishlist.getByCustomer(input);
  }
}
