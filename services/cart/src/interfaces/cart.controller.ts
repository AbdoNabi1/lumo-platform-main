import type { AbandonCart, AbandonCartInput } from "../application/abandon-cart.use-case";
import type { AddItem, AddItemInput } from "../application/add-item.use-case";
import type {
  AssignCartCustomer,
  AssignCartCustomerInput,
} from "../application/assign-cart-customer.use-case";
import type {
  ChangeItemQuantity,
  ChangeItemQuantityInput,
} from "../application/change-item-quantity.use-case";
import type { CheckOutCart, CheckOutCartInput } from "../application/check-out-cart.use-case";
import type { CreateCart, CreateCartInput } from "../application/create-cart.use-case";
import type { GetCart, GetCartInput } from "../application/get-cart.use-case";
import type { GetCurrentCart, GetCurrentCartInput } from "../application/get-current-cart.use-case";
import type { ListCarts, ListCartsInput } from "../application/list-carts.use-case";
import type {
  CartLifecycleInput,
  ClearCart,
  ExpireCart,
  LockCart,
  RestoreCart,
  SaveCartForLater,
  UnlockCart,
} from "../application/cart-lifecycle.use-cases";
import type { MergeGuestCart, MergeGuestCartInput } from "../application/merge-cart.use-case";
import type { RemoveItem, RemoveItemInput } from "../application/remove-item.use-case";
import type { ReplaceVariant, ReplaceVariantInput } from "../application/replace-variant.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface CartControllerDeps {
  readonly createCart: CreateCart;
  readonly getCart: GetCart;
  readonly getCurrentCart: GetCurrentCart;
  readonly listCarts: ListCarts;
  readonly addItem: AddItem;
  readonly removeItem: RemoveItem;
  readonly changeItemQuantity: ChangeItemQuantity;
  readonly checkOutCart: CheckOutCart;
  readonly abandonCart: AbandonCart;
  readonly replaceVariant: ReplaceVariant;
  readonly mergeGuestCart: MergeGuestCart;
  readonly assignCartCustomer: AssignCartCustomer;
  readonly lockCart: LockCart;
  readonly unlockCart: UnlockCart;
  readonly saveCartForLater: SaveCartForLater;
  readonly restoreCart: RestoreCart;
  readonly expireCart: ExpireCart;
  readonly clearCart: ClearCart;
}

/** Framework-agnostic interface boundary for cart use-cases (no HTTP server). */
export class CartController {
  private readonly deps: CartControllerDeps;

  constructor(deps: CartControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateCartInput): Promise<ControllerResponse> {
    return present(await this.deps.createCart.execute(input), 201);
  }

  async get(input: GetCartInput): Promise<ControllerResponse> {
    return present(await this.deps.getCart.execute(input), 200);
  }

  /** `body` is the caller's `Cart | null` (Phase 17.1) — `null` on a clean "no cart yet" outcome. */
  async getCurrent(input: GetCurrentCartInput): Promise<ControllerResponse> {
    return present(await this.deps.getCurrentCart.execute(input), 200);
  }

  async add(input: AddItemInput): Promise<ControllerResponse> {
    return present(await this.deps.addItem.execute(input), 200);
  }

  async remove(input: RemoveItemInput): Promise<ControllerResponse> {
    return present(await this.deps.removeItem.execute(input), 200);
  }

  async changeQuantity(input: ChangeItemQuantityInput): Promise<ControllerResponse> {
    return present(await this.deps.changeItemQuantity.execute(input), 200);
  }

  async replaceVariant(input: ReplaceVariantInput): Promise<ControllerResponse> {
    return present(await this.deps.replaceVariant.execute(input), 200);
  }

  async checkOut(input: CheckOutCartInput): Promise<ControllerResponse> {
    return present(await this.deps.checkOutCart.execute(input), 200);
  }

  async abandon(input: AbandonCartInput): Promise<ControllerResponse> {
    return present(await this.deps.abandonCart.execute(input), 200);
  }

  /** T5.17 — promotes a guest cart to a customer's cart in place (login-time cart continuity). */
  async assignCustomer(input: AssignCartCustomerInput): Promise<ControllerResponse> {
    return present(await this.deps.assignCartCustomer.execute(input), 200);
  }

  async merge(input: MergeGuestCartInput): Promise<ControllerResponse> {
    return present(await this.deps.mergeGuestCart.execute(input), 200);
  }

  async lock(input: CartLifecycleInput): Promise<ControllerResponse> {
    return present(await this.deps.lockCart.execute(input), 200);
  }

  async unlock(input: CartLifecycleInput): Promise<ControllerResponse> {
    return present(await this.deps.unlockCart.execute(input), 200);
  }

  async saveForLater(input: CartLifecycleInput): Promise<ControllerResponse> {
    return present(await this.deps.saveCartForLater.execute(input), 200);
  }

  async restore(input: CartLifecycleInput): Promise<ControllerResponse> {
    return present(await this.deps.restoreCart.execute(input), 200);
  }

  async expire(input: CartLifecycleInput): Promise<ControllerResponse> {
    return present(await this.deps.expireCart.execute(input), 200);
  }

  async clear(input: CartLifecycleInput): Promise<ControllerResponse> {
    return present(await this.deps.clearCart.execute(input), 200);
  }

  async list(input: ListCartsInput): Promise<ControllerResponse> {
    return present(await this.deps.listCarts.execute(input), 200);
  }
}
