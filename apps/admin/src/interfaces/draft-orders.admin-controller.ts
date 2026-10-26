import type { Principal } from "@platform/contracts";
import type { OrderController } from "@platform/orders";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface DraftOrdersAdminControllerDeps {
  readonly orders: OrderController;
  readonly guard: AdminGuard;
}

/** Order operations Part 4 — the staff side of drafts (spec Permissions). */
export class DraftOrdersAdminController {
  private readonly orders: OrderController;
  private readonly guard: AdminGuard;

  constructor(deps: DraftOrdersAdminControllerDeps) {
    this.orders = deps.orders;
    this.guard = deps.guard;
  }

  async list(
    principal: Principal,
    input: Parameters<OrderController["listDraftOrders"]>[0],
  ): Promise<AdminResponse> {
    return (
      (await this.guard.ensure(principal, "orders:read")) ?? this.orders.listDraftOrders(input)
    );
  }

  async get(
    principal: Principal,
    input: Parameters<OrderController["getDraftOrder"]>[0],
  ): Promise<AdminResponse> {
    return (await this.guard.ensure(principal, "orders:read")) ?? this.orders.getDraftOrder(input);
  }

  async create(
    principal: Principal,
    input: Parameters<OrderController["createDraftOrder"]>[0],
  ): Promise<AdminResponse> {
    return (
      (await this.guard.ensure(principal, "orders:draft")) ?? this.orders.createDraftOrder(input)
    );
  }

  async update(
    principal: Principal,
    input: Parameters<OrderController["updateDraftOrder"]>[0],
  ): Promise<AdminResponse> {
    return (
      (await this.guard.ensure(principal, "orders:draft")) ?? this.orders.updateDraftOrder(input)
    );
  }

  async remove(
    principal: Principal,
    input: Parameters<OrderController["deleteDraftOrder"]>[0],
  ): Promise<AdminResponse> {
    return (
      (await this.guard.ensure(principal, "orders:draft")) ?? this.orders.deleteDraftOrder(input)
    );
  }

  async markInvoiceSent(
    principal: Principal,
    input: Parameters<OrderController["markDraftInvoiceSent"]>[0],
  ): Promise<AdminResponse> {
    return (
      (await this.guard.ensure(principal, "orders:draft")) ??
      this.orders.markDraftInvoiceSent(input)
    );
  }

  /** Shipping rates and the invoice link (spec §4.8: `orders:draft`). */
  authorizeDraft(principal: Principal): Promise<AdminResponse | null> {
    return this.guard.ensure(principal, "orders:draft");
  }

  /**
   * Spec §4.8: `orders:complete_draft`, plus `payments:confirm_cod_collection` for "Mark as paid" — money
   * stays admin-only (Plan 1B-2).
   */
  async authorizeCompletion(
    principal: Principal,
    payment: "paid" | "collect_on_delivery",
  ): Promise<AdminResponse | null> {
    const denied = await this.guard.ensure(principal, "orders:complete_draft");
    if (denied !== null || payment !== "paid") return denied;
    return this.guard.ensure(principal, "payments:confirm_cod_collection");
  }
}
