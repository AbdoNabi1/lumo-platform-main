import type {
  AdjustInventory,
  AdjustInventoryInput,
} from "../application/adjust-inventory.use-case";
import type {
  CheckAvailability,
  CheckAvailabilityInput,
} from "../application/check-availability.use-case";
import type {
  CommitReservation,
  CommitReservationInput,
} from "../application/commit-reservation.use-case";
import type {
  ListInventoryByProduct,
  ListInventoryByProductInput,
} from "../application/list-inventory-by-product.use-case";
import type {
  ListInventoryItems,
  ListInventoryItemsInput,
} from "../application/list-inventory-items.use-case";
import type {
  ReleaseReservation,
  ReleaseReservationInput,
} from "../application/release-reservation.use-case";
import type { ReserveStock, ReserveStockInput } from "../application/reserve-stock.use-case";
import type { ReceiveStock, ReceiveStockInput } from "../application/receive-stock.use-case";
import type { TransferStock, TransferStockInput } from "../application/transfer-stock.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface InventoryControllerDeps {
  readonly receiveStock: ReceiveStock;
  readonly reserveStock: ReserveStock;
  readonly releaseReservation: ReleaseReservation;
  readonly adjustInventory: AdjustInventory;
  readonly commitReservation: CommitReservation;
  readonly transferStock: TransferStock;
  readonly listInventoryItems: ListInventoryItems;
  readonly checkAvailability: CheckAvailability;
  readonly listInventoryByProduct: ListInventoryByProduct;
}

/** Framework-agnostic interface boundary for inventory use-cases (no HTTP server). */
export class InventoryController {
  private readonly deps: InventoryControllerDeps;

  constructor(deps: InventoryControllerDeps) {
    this.deps = deps;
  }

  async receive(input: ReceiveStockInput): Promise<ControllerResponse> {
    return present(await this.deps.receiveStock.execute(input), 200);
  }

  async reserve(input: ReserveStockInput): Promise<ControllerResponse> {
    return present(await this.deps.reserveStock.execute(input), 201);
  }

  async release(input: ReleaseReservationInput): Promise<ControllerResponse> {
    return present(await this.deps.releaseReservation.execute(input), 200);
  }

  async adjust(input: AdjustInventoryInput): Promise<ControllerResponse> {
    return present(await this.deps.adjustInventory.execute(input), 200);
  }

  async commit(input: CommitReservationInput): Promise<ControllerResponse> {
    return present(await this.deps.commitReservation.execute(input), 200);
  }

  async transfer(input: TransferStockInput): Promise<ControllerResponse> {
    return present(await this.deps.transferStock.execute(input), 200);
  }

  async list(input: ListInventoryItemsInput): Promise<ControllerResponse> {
    return present(await this.deps.listInventoryItems.execute(input), 200);
  }

  async checkAvailability(input: CheckAvailabilityInput): Promise<ControllerResponse> {
    return present(await this.deps.checkAvailability.execute(input), 200);
  }

  async listByProduct(input: ListInventoryByProductInput): Promise<ControllerResponse> {
    return present(await this.deps.listInventoryByProduct.execute(input), 200);
  }
}
