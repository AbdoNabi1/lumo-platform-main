import { Entity, NotFoundError, ValidationError, type UniqueEntityId } from "@platform/domain";
import type { FieldIssue } from "@platform/utils";

export const MAX_RATE_BASIS_POINTS = 10_000;

export interface ProvinceRate {
  /** ISO 3166-2, for example `EG-C`. */
  readonly code: string;
  readonly rateBasisPoints: number;
}

export interface TaxRegionInput {
  readonly countryCode: string;
  readonly rateBasisPoints: number;
  readonly provinces: readonly ProvinceRate[];
}

function validRate(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_RATE_BASIS_POINTS;
}

function cleanRegion(input: TaxRegionInput): TaxRegionInput {
  const issues: FieldIssue[] = [];
  if (!/^[A-Z]{2}$/.test(input.countryCode)) {
    issues.push({ field: "countryCode", message: "must be an ISO 3166-1 alpha-2 code" });
  }
  if (!validRate(input.rateBasisPoints)) {
    issues.push({ field: "rateBasisPoints", message: "must be a whole number from 0 to 10000" });
  }
  const seen = new Set<string>();
  for (const province of input.provinces) {
    if (!province.code.startsWith(`${input.countryCode}-`)) {
      issues.push({
        field: "provinces",
        message: `${province.code} is not a province of ${input.countryCode}`,
      });
    }
    if (seen.has(province.code)) {
      issues.push({ field: "provinces", message: `${province.code} is listed twice` });
    }
    seen.add(province.code);
    if (!validRate(province.rateBasisPoints)) {
      issues.push({
        field: "provinces",
        message: `${province.code}: the rate must be a whole number from 0 to 10000`,
      });
    }
  }
  if (issues.length > 0) throw new ValidationError("Invalid tax region", issues);
  return {
    countryCode: input.countryCode,
    rateBasisPoints: input.rateBasisPoints,
    provinces: [...input.provinces]
      .map((p) => ({ code: p.code, rateBasisPoints: p.rateBasisPoints }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

interface TaxRegionProps {
  readonly countryCode: string;
  readonly rateBasisPoints: number;
  readonly provinces: readonly ProvinceRate[];
}

/**
 * Where the shop collects tax (Shopify: Taxes and duties → a country). One rate for the country, and
 * optional province rates that REPLACE it there (Shopify's "added to" / "compounded" modes are a
 * recorded gap).
 */
export class TaxRegion extends Entity<TaxRegionProps> {
  static create(id: UniqueEntityId, input: TaxRegionInput): TaxRegion {
    return new TaxRegion(cleanRegion(input), id);
  }

  static reconstitute(id: UniqueEntityId, props: TaxRegionProps): TaxRegion {
    return new TaxRegion({ ...props, provinces: [...props.provinces] }, id);
  }

  get countryCode(): string {
    return this.props.countryCode;
  }

  get rateBasisPoints(): number {
    return this.props.rateBasisPoints;
  }

  get provinces(): readonly ProvinceRate[] {
    return this.props.provinces;
  }

  /** The rate that applies at `province`: its override when there is one, else the country's. */
  rateFor(province: string | undefined): number {
    const override =
      province === undefined ? undefined : this.props.provinces.find((p) => p.code === province);
    return override?.rateBasisPoints ?? this.props.rateBasisPoints;
  }
}

/**
 * Shopify's Taxes and duties for one shop: whether prices include tax (default true — the norm in
 * Egypt), whether shipping is taxed (default false), and the regions where tax is collected. With no
 * region the tax is zero. One row per shop, so no id or version; a save replaces it.
 */
export class TaxSettings {
  private includesTax: boolean;
  private taxesShipping: boolean;
  private readonly taxRegions: TaxRegion[];

  private constructor(includesTax: boolean, taxesShipping: boolean, regions: TaxRegion[]) {
    this.includesTax = includesTax;
    this.taxesShipping = taxesShipping;
    this.taxRegions = regions;
  }

  static defaults(): TaxSettings {
    return new TaxSettings(true, false, []);
  }

  static reconstitute(props: {
    readonly pricesIncludeTax: boolean;
    readonly chargeTaxOnShipping: boolean;
    readonly regions: readonly TaxRegion[];
  }): TaxSettings {
    return new TaxSettings(props.pricesIncludeTax, props.chargeTaxOnShipping, [...props.regions]);
  }

  setFlags(flags: {
    readonly pricesIncludeTax: boolean;
    readonly chargeTaxOnShipping: boolean;
  }): void {
    this.includesTax = flags.pricesIncludeTax;
    this.taxesShipping = flags.chargeTaxOnShipping;
  }

  /** Adds the country's region, or replaces the one it already has (keeping that region's id). */
  upsertRegion(id: UniqueEntityId, input: TaxRegionInput): void {
    const existing = this.taxRegions.findIndex((r) => r.countryCode === input.countryCode);
    if (existing >= 0) {
      const current = this.taxRegions[existing];
      if (current !== undefined) {
        this.taxRegions[existing] = TaxRegion.create(current.id, input);
        return;
      }
    }
    this.taxRegions.push(TaxRegion.create(id, input));
  }

  removeRegion(countryCode: string): void {
    const index = this.taxRegions.findIndex((r) => r.countryCode === countryCode);
    if (index < 0) throw new NotFoundError("Tax region not found");
    this.taxRegions.splice(index, 1);
  }

  regionFor(countryCode: string): TaxRegion | undefined {
    return this.taxRegions.find((r) => r.countryCode === countryCode);
  }

  get pricesIncludeTax(): boolean {
    return this.includesTax;
  }

  get chargeTaxOnShipping(): boolean {
    return this.taxesShipping;
  }

  get regions(): readonly TaxRegion[] {
    return this.taxRegions;
  }
}
