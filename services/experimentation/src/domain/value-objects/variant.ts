import { Guard, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

interface VariantProps {
  readonly key: string;
  readonly allocationPercentage: number;
  readonly isControl: boolean;
}

/** One arm of an A/B or multivariate experiment. */
export class Variant extends ValueObject<VariantProps> {
  static create(
    key: string,
    allocationPercentage: number,
    isControl: boolean,
  ): Result<Variant, ValidationError> {
    const guardedKey = Guard.againstEmpty(key, "key");
    if (!guardedKey.ok) return err(guardedKey.error);
    const guardedAllocation = Guard.againstOutOfRange(
      allocationPercentage,
      0,
      100,
      "allocationPercentage",
    );
    if (!guardedAllocation.ok) return err(guardedAllocation.error);
    return ok(new Variant({ key, allocationPercentage, isControl }));
  }

  get key(): string {
    return this.props.key;
  }

  get allocationPercentage(): number {
    return this.props.allocationPercentage;
  }

  get isControl(): boolean {
    return this.props.isControl;
  }
}

/** Validates that a set of variant allocations sums to exactly 100. */
export function validateAllocationsSum(
  variants: readonly Variant[],
): Result<void, ValidationError> {
  const total = variants.reduce((sum, v) => sum + v.allocationPercentage, 0);
  if (total !== 100) {
    return err(
      new ValidationError("Invalid variant allocations", [
        { field: "variants", message: `allocations must sum to 100 (got ${total})` },
      ]),
    );
  }
  return ok(undefined);
}

interface ExperimentAudienceProps {
  readonly percentage: number;
  readonly segmentRefs?: readonly string[];
}

/** What fraction of eligible traffic is included in the experiment at all, before variant split. */
export class ExperimentAudience extends ValueObject<ExperimentAudienceProps> {
  static everyone(): ExperimentAudience {
    return new ExperimentAudience({ percentage: 100 });
  }

  static create(percentage: number, segmentRefs?: readonly string[]): ExperimentAudience {
    return new ExperimentAudience({ percentage, segmentRefs });
  }

  get percentage(): number {
    return this.props.percentage;
  }

  get segmentRefs(): readonly string[] | undefined {
    return this.props.segmentRefs;
  }
}
