import type {
  DeactivateWarehouse,
  DeactivateWarehouseInput,
  ListWarehouses,
  ListWarehousesInput,
  RegisterWarehouse,
  RegisterWarehouseInput,
} from "../application/warehouse.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface WarehouseControllerDeps {
  readonly registerWarehouse: RegisterWarehouse;
  readonly deactivateWarehouse: DeactivateWarehouse;
  readonly listWarehouses: ListWarehouses;
}

/** Framework-agnostic interface boundary for warehouse registry use-cases (no HTTP server). */
export class WarehouseController {
  private readonly deps: WarehouseControllerDeps;

  constructor(deps: WarehouseControllerDeps) {
    this.deps = deps;
  }

  async register(input: RegisterWarehouseInput): Promise<ControllerResponse> {
    return present(await this.deps.registerWarehouse.execute(input), 201);
  }

  async list(input: ListWarehousesInput): Promise<ControllerResponse> {
    return present(await this.deps.listWarehouses.execute(input), 200);
  }

  async deactivate(input: DeactivateWarehouseInput): Promise<ControllerResponse> {
    return present(await this.deps.deactivateWarehouse.execute(input), 200);
  }
}
