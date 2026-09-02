import { AggregateRoot, type UniqueEntityId, ValidationError } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import type { TaxRate } from "./value-objects/tax-rate";

interface TaxProfileProps {
  readonly jurisdiction: string;
  rates: readonly TaxRate[];
}

/** The set of tax rates that apply within a jurisdiction, used by `TaxCalculator` (M2). */
export class TaxProfile extends AggregateRoot<TaxProfileProps> {
  static define(
    id: UniqueEntityId,
    jurisdiction: string,
    rates: readonly TaxRate[],
  ): Result<TaxProfile, ValidationError> {
    if (jurisdiction.trim().length === 0) {
      return err(
        new ValidationError("Invalid tax profile", [
          { field: "jurisdiction", message: "must not be empty" },
        ]),
      );
    }
    return ok(new TaxProfile({ jurisdiction, rates: [...rates] }, id));
  }

  static reconstitute(
    id: UniqueEntityId,
    jurisdiction: string,
    rates: readonly TaxRate[],
    version: number,
  ): TaxProfile {
    return new TaxProfile({ jurisdiction, rates: [...rates] }, id, version);
  }

  setRates(rates: readonly TaxRate[]): void {
    this.props.rates = [...rates];
  }

  get jurisdiction(): string {
    return this.props.jurisdiction;
  }

  get rates(): readonly TaxRate[] {
    return this.props.rates;
  }
}
