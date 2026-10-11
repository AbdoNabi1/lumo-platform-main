import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import {
  calculateTax,
  type TaxDestination,
  type TaxResult,
  type TaxableLine,
} from "../domain/tax-calculation";
import { TaxSettings } from "../domain/tax-settings";
import type { TaxSettingsRepository } from "../domain/tax-settings-repository";
import type { TenantInput } from "./tax-settings.use-cases";

export interface CalculateStoreTaxInput extends TenantInput {
  /** Resolved server-side from Catalog by the caller's adapter (`taxable` especially), never taken from a browser. */
  readonly lines: readonly TaxableLine[];
  readonly destination: TaxDestination;
  /** The chosen shipping rate's price; taxed only when the shop charges tax on shipping. */
  readonly shippingMinor: number;
}

/**
 * Plan 3C: the tax on a checkout under the shop's own settings — Shopify's rules (see
 * {@link calculateTax}). A shop that has set nothing up has no region, so the tax is zero.
 */
export class CalculateStoreTax implements UseCase<CalculateStoreTaxInput, TaxResult, DomainError> {
  private readonly deps: { readonly settings: TaxSettingsRepository };

  constructor(deps: { readonly settings: TaxSettingsRepository }) {
    this.deps = deps;
  }

  async execute(input: CalculateStoreTaxInput): Promise<Result<TaxResult, DomainError>> {
    if (input.destination.country.trim().length === 0) {
      return err(
        new ValidationError("Invalid destination", [{ field: "country", message: "required" }]),
      );
    }
    if (!Number.isInteger(input.shippingMinor) || input.shippingMinor < 0) {
      return err(
        new ValidationError("Invalid shipping price", [
          { field: "shippingMinor", message: "must be a non-negative integer" },
        ]),
      );
    }
    const settings = (await this.deps.settings.get(input.tenantId)) ?? TaxSettings.defaults();
    return ok(calculateTax(settings, input.lines, input.destination, input.shippingMinor));
  }
}
