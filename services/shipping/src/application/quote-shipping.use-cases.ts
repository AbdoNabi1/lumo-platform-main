import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import {
  quoteRates,
  type QuoteAddress,
  type QuoteLine,
  type QuotedRate,
} from "../domain/quote-rates";
import { REST_OF_WORLD } from "../domain/shipping-zone";
import type { ShippingZoneRepository } from "../domain/shipping-zone-repository";
import type { TenantInput } from "./shipping-zones.use-cases";

export interface QuoteShippingRatesInput extends TenantInput {
  readonly address: QuoteAddress;
  /** Resolved server-side from Catalog by the caller's adapter, never taken from a browser. */
  readonly lines: readonly QuoteLine[];
}

/**
 * Plan 3C: the rates the shop offers for an address and a set of lines — Shopify's rules (see
 * {@link quoteRates}). No rates means the shop does not ship there.
 */
export class QuoteShippingRates implements UseCase<
  QuoteShippingRatesInput,
  { rates: readonly QuotedRate[] },
  DomainError
> {
  private readonly deps: { readonly zones: ShippingZoneRepository };

  constructor(deps: { readonly zones: ShippingZoneRepository }) {
    this.deps = deps;
  }

  async execute(
    input: QuoteShippingRatesInput,
  ): Promise<Result<{ rates: readonly QuotedRate[] }, DomainError>> {
    if (input.address.country.trim().length === 0) {
      return err(
        new ValidationError("Invalid address", [{ field: "country", message: "required" }]),
      );
    }
    const zones = await this.deps.zones.list(input.tenantId);
    return ok({ rates: quoteRates(zones, input.address, input.lines) });
  }
}

export interface ShippableCountries {
  /** ISO 3166-1 codes of the countries some zone ships to (rest of world not included). */
  readonly countries: readonly string[];
  /** True when a zone covers rest of world: the checkout then offers every country. */
  readonly restOfWorld: boolean;
}

/** Plan 3C: which countries the checkout may offer — those the shop's zones ship to. */
export class ListShippableCountries implements UseCase<
  TenantInput,
  ShippableCountries,
  DomainError
> {
  private readonly deps: { readonly zones: ShippingZoneRepository };

  constructor(deps: { readonly zones: ShippingZoneRepository }) {
    this.deps = deps;
  }

  async execute(input: TenantInput): Promise<Result<ShippableCountries, DomainError>> {
    const zones = await this.deps.zones.list(input.tenantId);
    const codes = new Set<string>();
    let restOfWorld = false;
    for (const zone of zones) {
      for (const country of zone.countries) {
        if (country.code === REST_OF_WORLD) restOfWorld = true;
        else codes.add(country.code);
      }
    }
    return ok({ countries: [...codes].sort(), restOfWorld });
  }
}
