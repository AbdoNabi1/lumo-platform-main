import type { UseCase } from "@platform/application";
import type { IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { COUNTRY_CODES, PROVINCES } from "@platform/regions";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import {
  type DomainError,
  type FieldIssue,
  NotFoundError,
  ValidationError,
  isDomainError,
} from "@platform/utils";
import { TaxSettings, type ProvinceRate, type TaxRegion } from "../domain/tax-settings";
import type { TaxSettingsRepository } from "../domain/tax-settings-repository";

export interface TaxSettingsDeps {
  readonly settings: TaxSettingsRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
}

export interface TaxRegionView {
  readonly countryCode: string;
  readonly rateBasisPoints: number;
  readonly provinces: readonly ProvinceRate[];
}

/** The wire shape of the shop's tax settings — never the aggregate itself. */
export interface TaxSettingsView {
  readonly pricesIncludeTax: boolean;
  readonly chargeTaxOnShipping: boolean;
  readonly regions: readonly TaxRegionView[];
}

function toRegionView(region: TaxRegion): TaxRegionView {
  return {
    countryCode: region.countryCode,
    rateBasisPoints: region.rateBasisPoints,
    provinces: region.provinces.map((p) => ({ code: p.code, rateBasisPoints: p.rateBasisPoints })),
  };
}

export function toTaxSettingsView(settings: TaxSettings): TaxSettingsView {
  return {
    pricesIncludeTax: settings.pricesIncludeTax,
    chargeTaxOnShipping: settings.chargeTaxOnShipping,
    regions: settings.regions.map(toRegionView),
  };
}

export interface TenantInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

async function load(deps: TaxSettingsDeps, tenantId: string, tx?: unknown): Promise<TaxSettings> {
  return (await deps.settings.get(tenantId, tx)) ?? TaxSettings.defaults();
}

function attempt<T>(change: () => T): Result<T, DomainError> {
  try {
    return ok(change());
  } catch (error) {
    if (isDomainError(error)) return err(error);
    throw error;
  }
}

export class GetTaxSettings implements UseCase<TenantInput, TaxSettingsView, DomainError> {
  private readonly deps: TaxSettingsDeps;

  constructor(deps: TaxSettingsDeps) {
    this.deps = deps;
  }

  async execute(input: TenantInput): Promise<Result<TaxSettingsView, DomainError>> {
    return ok(toTaxSettingsView(await load(this.deps, input.tenantId)));
  }
}

export interface UpdateTaxSettingsInput extends TenantInput {
  readonly pricesIncludeTax: boolean;
  readonly chargeTaxOnShipping: boolean;
}

/** Saves the two switches — "All prices include tax" and "Charge tax on shipping rates". */
export class UpdateTaxSettings implements UseCase<
  UpdateTaxSettingsInput,
  TaxSettingsView,
  DomainError
> {
  private readonly deps: TaxSettingsDeps;

  constructor(deps: TaxSettingsDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateTaxSettingsInput): Promise<Result<TaxSettingsView, DomainError>> {
    return this.deps.unitOfWork.run<Result<TaxSettingsView, DomainError>>(async (tx) => {
      const settings = await load(this.deps, input.tenantId, tx);
      settings.setFlags({
        pricesIncludeTax: input.pricesIncludeTax,
        chargeTaxOnShipping: input.chargeTaxOnShipping,
      });
      await this.deps.settings.save(settings, input.tenantId, tx);
      return ok(toTaxSettingsView(settings));
    });
  }
}

export interface UpsertTaxRegionInput extends TenantInput {
  readonly countryCode: string;
  readonly rateBasisPoints: number;
  readonly provinces: readonly ProvinceRate[];
}

/** Region checks that need the region data: a real country, and provinces that belong to it. */
function regionIssues(input: UpsertTaxRegionInput): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!COUNTRY_CODES.includes(input.countryCode)) {
    issues.push({ field: "countryCode", message: `${input.countryCode} is not a country code` });
    return issues;
  }
  const known = new Set((PROVINCES[input.countryCode] ?? []).map((province) => province.code));
  for (const province of input.provinces) {
    if (!known.has(province.code)) {
      issues.push({
        field: "provinces",
        message: `${province.code} is not a province of ${input.countryCode}`,
      });
    }
  }
  return issues;
}

/** Adds the country's region, or replaces it (one region per country). */
export class UpsertTaxRegion implements UseCase<
  UpsertTaxRegionInput,
  TaxSettingsView,
  DomainError
> {
  private readonly deps: TaxSettingsDeps;

  constructor(deps: TaxSettingsDeps) {
    this.deps = deps;
  }

  async execute(input: UpsertTaxRegionInput): Promise<Result<TaxSettingsView, DomainError>> {
    const issues = regionIssues(input);
    if (issues.length > 0) return err(new ValidationError("Invalid tax region", issues));
    return this.deps.unitOfWork.run<Result<TaxSettingsView, DomainError>>(async (tx) => {
      const settings = await load(this.deps, input.tenantId, tx);
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const changed = attempt(() =>
        settings.upsertRegion(id, {
          countryCode: input.countryCode,
          rateBasisPoints: input.rateBasisPoints,
          provinces: input.provinces,
        }),
      );
      if (!changed.ok) return err(changed.error);
      await this.deps.settings.save(settings, input.tenantId, tx);
      return ok(toTaxSettingsView(settings));
    });
  }
}

export interface DeleteTaxRegionInput extends TenantInput {
  readonly countryCode: string;
}

export class DeleteTaxRegion implements UseCase<
  DeleteTaxRegionInput,
  TaxSettingsView,
  DomainError
> {
  private readonly deps: TaxSettingsDeps;

  constructor(deps: TaxSettingsDeps) {
    this.deps = deps;
  }

  async execute(input: DeleteTaxRegionInput): Promise<Result<TaxSettingsView, DomainError>> {
    return this.deps.unitOfWork.run<Result<TaxSettingsView, DomainError>>(async (tx) => {
      const stored = await this.deps.settings.get(input.tenantId, tx);
      if (stored === null) return err(new NotFoundError("Tax region not found"));
      const removed = attempt(() => stored.removeRegion(input.countryCode));
      if (!removed.ok) return err(removed.error);
      await this.deps.settings.save(stored, input.tenantId, tx);
      return ok(toTaxSettingsView(stored));
    });
  }
}
