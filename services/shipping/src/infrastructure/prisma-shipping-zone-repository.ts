import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { Prisma } from "@prisma/client";
import type { ShippingZone } from "../domain/shipping-zone";
import type { ShippingZoneRepository } from "../domain/shipping-zone-repository";
import { ShippingZoneMapper, type ShippingZoneRow } from "./shipping-zone.mapper";

export interface PrismaShippingZoneRepositoryDeps {
  readonly prisma: Database;
}

const WITH_RATES = { rates: { orderBy: { position: "asc" } } } as const;

/** ADR-0014: reuse the caller's `tx` if given, else scope the read via `runReadScoped`. */
function readScoped<T>(
  prisma: Database,
  tenantId: string,
  tx: unknown,
  run: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  return tx !== undefined && tx !== null
    ? run(tx as TransactionClient)
    : runReadScoped(prisma, tenantId, run);
}

/**
 * Production `ShippingZoneRepository` on `shipping.shipping_zones` / `shipping_rates`. A save replaces
 * the zone's rate set inside the caller's transaction: rates no longer on the aggregate are deleted,
 * the rest are updated in place or created. Every statement carries the caller's `tenantId`.
 */
export class PrismaShippingZoneRepository implements ShippingZoneRepository {
  private readonly deps: PrismaShippingZoneRepositoryDeps;

  constructor(deps: PrismaShippingZoneRepositoryDeps) {
    this.deps = deps;
  }

  async save(zone: ShippingZone, tenantId: string, tx?: unknown): Promise<void> {
    if (tx === undefined || tx === null) {
      throw new Error("PrismaShippingZoneRepository requires a transaction client (ADR-0003)");
    }
    const client = tx as TransactionClient;
    const id = zone.id.toString();
    const data = ShippingZoneMapper.toZoneData(zone);
    const json = data.countries as unknown as Prisma.InputJsonValue;

    const updated = await client.shippingZone.updateMany({
      where: { id, tenantId },
      data: { ...data, countries: json },
    });
    if (updated.count === 0) {
      await client.shippingZone.create({ data: { id, tenantId, ...data, countries: json } });
    }

    const rates = ShippingZoneMapper.toRateRows(zone, tenantId);
    await client.shippingRate.deleteMany({
      where: { zoneId: id, tenantId, id: { notIn: rates.map((rate) => rate.id) } },
    });
    for (const rate of rates) {
      const { id: rateId, tenantId: _tenant, zoneId: _zone, ...fields } = rate;
      const changed = await client.shippingRate.updateMany({
        where: { id: rateId, tenantId, zoneId: id },
        data: fields,
      });
      if (changed.count === 0) await client.shippingRate.create({ data: rate });
    }
  }

  findById(id: string, tenantId: string, tx?: unknown): Promise<ShippingZone | null> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const row = await client.shippingZone.findFirst({
        where: { id, tenantId },
        include: WITH_RATES,
      });
      return row === null ? null : ShippingZoneMapper.toDomain(row);
    });
  }

  list(tenantId: string, tx?: unknown): Promise<readonly ShippingZone[]> {
    return readScoped(this.deps.prisma, tenantId, tx, async (client) => {
      const rows = await client.shippingZone.findMany({
        where: { tenantId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        include: WITH_RATES,
      });
      return rows.map((row) => ShippingZoneMapper.toDomain(row as ShippingZoneRow));
    });
  }

  async delete(id: string, tenantId: string, tx?: unknown): Promise<void> {
    if (tx === undefined || tx === null) {
      throw new Error("PrismaShippingZoneRepository requires a transaction client (ADR-0003)");
    }
    const client = tx as TransactionClient;
    await client.shippingRate.deleteMany({ where: { zoneId: id, tenantId } });
    await client.shippingZone.deleteMany({ where: { id, tenantId } });
  }
}
