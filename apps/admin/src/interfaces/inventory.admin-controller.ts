import type { Principal } from "@platform/contracts";
import type { InventoryController, WarehouseController } from "@platform/inventory";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface InventoryAdminControllerDeps {
  readonly inventory: InventoryController;
  readonly warehouse: WarehouseController;
  readonly guard: AdminGuard;
}

/**
 * Wires the frozen **Inventory** admin screen to the Inventory context. Pure delegation — the
 * screen's `adjust` action maps to `AdjustInventory`, plus receive/reserve/release/commit/transfer
 * and the warehouse registry (register/deactivate, Sprint 4.3). Every action authorizes the
 * acting principal first (RBAC seam, ADR-0007; permissive until real RBAC lands).
 */
export class InventoryAdminController {
  private readonly inventory: InventoryController;
  private readonly warehouse: WarehouseController;
  private readonly guard: AdminGuard;

  constructor(deps: InventoryAdminControllerDeps) {
    this.inventory = deps.inventory;
    this.warehouse = deps.warehouse;
    this.guard = deps.guard;
  }

  async receiveStock(
    principal: Principal,
    input: Parameters<InventoryController["receive"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "inventory:receive");
    if (denied) return denied;
    return this.inventory.receive(input);
  }

  async adjustStock(
    principal: Principal,
    input: Parameters<InventoryController["adjust"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "inventory:adjust");
    if (denied) return denied;
    return this.inventory.adjust(input);
  }

  async reserveStock(
    principal: Principal,
    input: Parameters<InventoryController["reserve"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "inventory:reserve");
    if (denied) return denied;
    return this.inventory.reserve(input);
  }

  async releaseReservation(
    principal: Principal,
    input: Parameters<InventoryController["release"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "inventory:release");
    if (denied) return denied;
    return this.inventory.release(input);
  }

  async commitReservation(
    principal: Principal,
    input: Parameters<InventoryController["commit"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "inventory:commit");
    if (denied) return denied;
    return this.inventory.commit(input);
  }

  async transferStock(
    principal: Principal,
    input: Parameters<InventoryController["transfer"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "inventory:transfer");
    if (denied) return denied;
    return this.inventory.transfer(input);
  }

  async inventoryForProduct(
    principal: Principal,
    input: Parameters<InventoryController["listByProduct"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "inventory:read");
    if (denied) return denied;
    return this.inventory.listByProduct(input);
  }

  async registerWarehouse(
    principal: Principal,
    input: Parameters<WarehouseController["register"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "warehouse:register");
    if (denied) return denied;
    return this.warehouse.register(input);
  }

  async deactivateWarehouse(
    principal: Principal,
    input: Parameters<WarehouseController["deactivate"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "warehouse:deactivate");
    if (denied) return denied;
    return this.warehouse.deactivate(input);
  }
}
