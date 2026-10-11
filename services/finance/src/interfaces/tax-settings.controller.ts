import type {
  CalculateStoreTax,
  CalculateStoreTaxInput,
} from "../application/calculate-store-tax.use-case";
import type {
  DeleteTaxRegion,
  DeleteTaxRegionInput,
  GetTaxSettings,
  TenantInput,
  UpdateTaxSettings,
  UpdateTaxSettingsInput,
  UpsertTaxRegion,
  UpsertTaxRegionInput,
} from "../application/tax-settings.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface TaxSettingsControllerDeps {
  readonly getTaxSettings: GetTaxSettings;
  readonly updateTaxSettings: UpdateTaxSettings;
  readonly upsertTaxRegion: UpsertTaxRegion;
  readonly deleteTaxRegion: DeleteTaxRegion;
  readonly calculateStoreTax: CalculateStoreTax;
}

/** Framework-agnostic interface boundary for the shop's tax settings (Plan 3C). */
export class TaxSettingsController {
  private readonly deps: TaxSettingsControllerDeps;

  constructor(deps: TaxSettingsControllerDeps) {
    this.deps = deps;
  }

  async get(input: TenantInput): Promise<ControllerResponse> {
    return present(await this.deps.getTaxSettings.execute(input), 200);
  }

  async update(input: UpdateTaxSettingsInput): Promise<ControllerResponse> {
    return present(await this.deps.updateTaxSettings.execute(input), 200);
  }

  async upsertRegion(input: UpsertTaxRegionInput): Promise<ControllerResponse> {
    return present(await this.deps.upsertTaxRegion.execute(input), 200);
  }

  async deleteRegion(input: DeleteTaxRegionInput): Promise<ControllerResponse> {
    return present(await this.deps.deleteTaxRegion.execute(input), 200);
  }

  /** The tax on a checkout under the shop's own settings (Plan 3C); the checkout's tax adapter calls this. */
  async calculate(input: CalculateStoreTaxInput): Promise<ControllerResponse> {
    return present(await this.deps.calculateStoreTax.execute(input), 200);
  }
}
