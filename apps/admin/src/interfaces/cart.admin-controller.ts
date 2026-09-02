import type { Principal } from "@platform/contracts";
import type { CartController } from "@platform/cart";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface CartAdminControllerDeps {
  readonly cart: CartController;
  readonly guard: AdminGuard;
}

/**
 * Wires the **Cart** admin screen to the Cart context (Sprint 4.5 — Cart had no HTTP surface
 * before). Pure delegation over the cart lifecycle: create/add/remove/change-quantity/
 * replace-variant/merge/lock/unlock/save/restore/expire/clear/checkout/abandon. Every action
 * authorizes the acting principal first (RBAC seam, ADR-0007; permissive until real RBAC lands).
 * Cart is storefront-facing; exposed here through the admin transport only because it is the sole
 * transport built so far (per `SPRINT_4_5_CART_CORE_REPORT.md` §5) — a dedicated storefront
 * transport supersedes this later.
 */
export class CartAdminController {
  private readonly cart: CartController;
  private readonly guard: AdminGuard;

  constructor(deps: CartAdminControllerDeps) {
    this.cart = deps.cart;
    this.guard = deps.guard;
  }

  async create(
    principal: Principal,
    input: Parameters<CartController["create"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:create");
    if (denied) return denied;
    return this.cart.create(input);
  }

  async addItem(
    principal: Principal,
    input: Parameters<CartController["add"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:add_item");
    if (denied) return denied;
    return this.cart.add(input);
  }

  async removeItem(
    principal: Principal,
    input: Parameters<CartController["remove"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:remove_item");
    if (denied) return denied;
    return this.cart.remove(input);
  }

  async changeItemQuantity(
    principal: Principal,
    input: Parameters<CartController["changeQuantity"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:change_quantity");
    if (denied) return denied;
    return this.cart.changeQuantity(input);
  }

  async replaceVariant(
    principal: Principal,
    input: Parameters<CartController["replaceVariant"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:replace_variant");
    if (denied) return denied;
    return this.cart.replaceVariant(input);
  }

  async merge(
    principal: Principal,
    input: Parameters<CartController["merge"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:merge");
    if (denied) return denied;
    return this.cart.merge(input);
  }

  async lock(
    principal: Principal,
    input: Parameters<CartController["lock"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:lock");
    if (denied) return denied;
    return this.cart.lock(input);
  }

  async unlock(
    principal: Principal,
    input: Parameters<CartController["unlock"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:unlock");
    if (denied) return denied;
    return this.cart.unlock(input);
  }

  async saveForLater(
    principal: Principal,
    input: Parameters<CartController["saveForLater"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:save_for_later");
    if (denied) return denied;
    return this.cart.saveForLater(input);
  }

  async restore(
    principal: Principal,
    input: Parameters<CartController["restore"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:restore");
    if (denied) return denied;
    return this.cart.restore(input);
  }

  async expire(
    principal: Principal,
    input: Parameters<CartController["expire"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:expire");
    if (denied) return denied;
    return this.cart.expire(input);
  }

  async clear(
    principal: Principal,
    input: Parameters<CartController["clear"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:clear");
    if (denied) return denied;
    return this.cart.clear(input);
  }

  async checkOut(
    principal: Principal,
    input: Parameters<CartController["checkOut"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:checkout");
    if (denied) return denied;
    return this.cart.checkOut(input);
  }

  async abandon(
    principal: Principal,
    input: Parameters<CartController["abandon"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:abandon");
    if (denied) return denied;
    return this.cart.abandon(input);
  }

  async get(
    principal: Principal,
    input: Parameters<CartController["get"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:read");
    if (denied) return denied;
    return this.cart.get(input);
  }

  async list(
    principal: Principal,
    input: Parameters<CartController["list"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "cart:read");
    if (denied) return denied;
    return this.cart.list(input);
  }
}
