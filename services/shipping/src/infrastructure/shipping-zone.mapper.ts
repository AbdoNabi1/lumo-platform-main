import { UniqueEntityId } from "@platform/domain";
import {
  ShippingRate,
  ShippingZone,
  type RateCondition,
  type ZoneCountry,
} from "../domain/shipping-zone";

export interface ShippingRateRow {
  readonly id: string;
  readonly name: string;
  readonly priceMinor: number;
  readonly conditionType: string;
  readonly conditionMin: bigint | number | null;
  readonly conditionMax: bigint | number | null;
  readonly description: string | null;
  readonly position: number;
}

export interface ShippingZoneRow {
  readonly id: string;
  readonly name: string;
  readonly profile: string;
  readonly countries: unknown;
  readonly position: number;
  readonly rates: readonly ShippingRateRow[];
}

function numberOrUndefined(value: bigint | number | null): number | undefined {
  return value === null ? undefined : Number(value);
}

function conditionOf(row: ShippingRateRow): RateCondition {
  const min = numberOrUndefined(row.conditionMin);
  const max = numberOrUndefined(row.conditionMax);
  if (row.conditionType === "order_price") {
    return {
      type: "orderPrice",
      ...(min === undefined ? {} : { minMinor: min }),
      ...(max === undefined ? {} : { maxMinor: max }),
    };
  }
  if (row.conditionType === "weight") {
    return {
      type: "weight",
      ...(min === undefined ? {} : { minGrams: min }),
      ...(max === undefined ? {} : { maxGrams: max }),
    };
  }
  return { type: "none" };
}

function countriesOf(value: unknown): ZoneCountry[] {
  if (!Array.isArray(value)) throw new Error("Corrupt shipping_zones.countries: not an array");
  return value.map((entry: unknown) => {
    const candidate = entry as { code?: unknown; provinces?: unknown };
    if (typeof candidate.code !== "string") {
      throw new Error("Corrupt shipping_zones.countries: an entry has no code");
    }
    const provinces = candidate.provinces;
    return {
      code: candidate.code,
      provinces: Array.isArray(provinces) ? provinces.map(String) : null,
    };
  });
}

/** Maps between the `ShippingZone` aggregate (with its rates) and `shipping.shipping_zones` / `shipping_rates` rows. */
export class ShippingZoneMapper {
  static toDomain(row: ShippingZoneRow): ShippingZone {
    return ShippingZone.reconstitute(UniqueEntityId.from(row.id), {
      name: row.name,
      profile: row.profile,
      countries: countriesOf(row.countries),
      position: row.position,
      rates: row.rates.map((rate) =>
        ShippingRate.reconstitute(UniqueEntityId.from(rate.id), {
          name: rate.name,
          priceMinor: rate.priceMinor,
          condition: conditionOf(rate),
          description: rate.description,
          position: rate.position,
        }),
      ),
    });
  }

  static toZoneData(zone: ShippingZone) {
    return {
      name: zone.name,
      profile: zone.profile,
      countries: zone.countries.map((c) => ({ code: c.code, provinces: c.provinces })),
      position: zone.position,
    };
  }

  static toRateRows(zone: ShippingZone, tenantId: string) {
    return zone.rates.map((rate) => {
      const condition = rate.condition;
      const [type, min, max] =
        condition.type === "orderPrice"
          ? (["order_price", condition.minMinor, condition.maxMinor] as const)
          : condition.type === "weight"
            ? (["weight", condition.minGrams, condition.maxGrams] as const)
            : (["none", undefined, undefined] as const);
      return {
        id: rate.id.toString(),
        tenantId,
        zoneId: zone.id.toString(),
        name: rate.name,
        priceMinor: rate.priceMinor,
        conditionType: type,
        conditionMin: min === undefined ? null : BigInt(min),
        conditionMax: max === undefined ? null : BigInt(max),
        description: rate.description,
        position: rate.position,
      };
    });
  }
}
