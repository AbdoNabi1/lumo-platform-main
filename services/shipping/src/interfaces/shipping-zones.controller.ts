import type {
  AddRate,
  AddRateInput,
  CreateZone,
  CreateZoneInput,
  DeleteRate,
  DeleteRateInput,
  DeleteZone,
  ListZones,
  TenantInput,
  UpdateRate,
  UpdateRateInput,
  UpdateZone,
  UpdateZoneInput,
  ZoneIdInput,
} from "../application/shipping-zones.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface ShippingZonesControllerDeps {
  readonly listZones: ListZones;
  readonly createZone: CreateZone;
  readonly updateZone: UpdateZone;
  readonly deleteZone: DeleteZone;
  readonly addRate: AddRate;
  readonly updateRate: UpdateRate;
  readonly deleteRate: DeleteRate;
}

/** Framework-agnostic interface boundary for the shipping zones and rates (Plan 3C). */
export class ShippingZonesController {
  private readonly deps: ShippingZonesControllerDeps;

  constructor(deps: ShippingZonesControllerDeps) {
    this.deps = deps;
  }

  async list(input: TenantInput): Promise<ControllerResponse> {
    return present(await this.deps.listZones.execute(input), 200);
  }

  async create(input: CreateZoneInput): Promise<ControllerResponse> {
    return present(await this.deps.createZone.execute(input), 201);
  }

  async update(input: UpdateZoneInput): Promise<ControllerResponse> {
    return present(await this.deps.updateZone.execute(input), 200);
  }

  async remove(input: ZoneIdInput): Promise<ControllerResponse> {
    return present(await this.deps.deleteZone.execute(input), 200);
  }

  async addRate(input: AddRateInput): Promise<ControllerResponse> {
    return present(await this.deps.addRate.execute(input), 201);
  }

  async updateRate(input: UpdateRateInput): Promise<ControllerResponse> {
    return present(await this.deps.updateRate.execute(input), 200);
  }

  async deleteRate(input: DeleteRateInput): Promise<ControllerResponse> {
    return present(await this.deps.deleteRate.execute(input), 200);
  }
}
