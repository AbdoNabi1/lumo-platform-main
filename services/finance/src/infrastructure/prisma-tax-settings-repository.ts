import { runReadScoped, type Database, type Prisma, type TransactionClient } from "@platform/db";
import { UniqueEntityId } from "@platform/domain";
import { TaxRegion, TaxSettings, type ProvinceRate } from "../domain/tax-settings";
import type { TaxSettingsRepository } from "../domain/tax-settings-repository";

export interface PrismaTaxSettingsRepositoryDeps {
  readonly prisma: Database;
}

function provincesOf(value: unknown): ProvinceRate[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry: unknown) => {
    const candidate = entry as { code?: unknown; rateBasisPoints?: unknown };
    if (typeof candidate.code !== "string" || typeof candidate.rateBasisPoints !== "number") {
      throw new Error("Corrupt tax_regions.provinces: an entry is not { code, rateBasisPoints }");
    }
    return { code: candidate.code, rateBasisPoints: candidate.rateBasisPoints };
  });
}

/**
 * Production `TaxSettingsRepository` on `finance.tax_settings` / `tax_regions`. A save replaces the
 * shop's flags and its region set inside the caller's transaction. Every statement carries the
 * caller's `tenantId`.
 */
export class PrismaTaxSettingsRepository implements TaxSettingsRepository {
  private readonly deps: PrismaTaxSettingsRepositoryDeps;

  constructor(deps: PrismaTaxSettingsRepositoryDeps) {
    this.deps = deps;
  }

  get(tenantId: string, tx?: unknown): Promise<TaxSettings | null> {
    const read = async (client: TransactionClient): Promise<TaxSettings | null> => {
      const row = await client.taxSettings.findFirst({ where: { tenantId } });
      const regions = await client.taxRegion.findMany({
        where: { tenantId },
        orderBy: { countryCode: "asc" },
      });
      if (row === null && regions.length === 0) return null;
      return TaxSettings.reconstitute({
        pricesIncludeTax: row?.pricesIncludeTax ?? true,
        chargeTaxOnShipping: row?.chargeTaxOnShipping ?? false,
        regions: regions.map((region) =>
          TaxRegion.reconstitute(UniqueEntityId.from(region.id), {
            countryCode: region.countryCode,
            rateBasisPoints: region.rateBasisPoints,
            provinces: provincesOf(region.provinces),
          }),
        ),
      });
    };
    return tx !== undefined && tx !== null
      ? read(tx as TransactionClient)
      : runReadScoped(this.deps.prisma, tenantId, read);
  }

  async save(settings: TaxSettings, tenantId: string, tx?: unknown): Promise<void> {
    if (tx === undefined || tx === null) {
      throw new Error("PrismaTaxSettingsRepository requires a transaction client (ADR-0003)");
    }
    const client = tx as TransactionClient;
    const flags = {
      pricesIncludeTax: settings.pricesIncludeTax,
      chargeTaxOnShipping: settings.chargeTaxOnShipping,
    };
    await client.taxSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...flags },
      update: flags,
    });

    await client.taxRegion.deleteMany({
      where: { tenantId, countryCode: { notIn: settings.regions.map((r) => r.countryCode) } },
    });
    for (const region of settings.regions) {
      const data = {
        rateBasisPoints: region.rateBasisPoints,
        provinces: region.provinces.map((p) => ({
          code: p.code,
          rateBasisPoints: p.rateBasisPoints,
        })) as unknown as Prisma.InputJsonValue,
      };
      const changed = await client.taxRegion.updateMany({
        where: { tenantId, countryCode: region.countryCode },
        data,
      });
      if (changed.count === 0) {
        await client.taxRegion.create({
          data: { id: region.id.toString(), tenantId, countryCode: region.countryCode, ...data },
        });
      }
    }
  }
}
