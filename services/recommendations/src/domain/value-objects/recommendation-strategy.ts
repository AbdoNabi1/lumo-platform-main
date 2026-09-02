import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

export type RecommendationStrategyValue =
  | "related"
  | "frequently_bought_together"
  | "recently_viewed"
  | "personalized"
  | "trending"
  | "popular"
  | "similar";

const VALID_STRATEGIES: readonly RecommendationStrategyValue[] = [
  "related",
  "frequently_bought_together",
  "recently_viewed",
  "personalized",
  "trending",
  "popular",
  "similar",
];

interface RecommendationStrategyProps {
  readonly value: RecommendationStrategyValue;
}

/** How a recommendation model derives its scored product sets. */
export class RecommendationStrategy extends ValueObject<RecommendationStrategyProps> {
  static create(value: string): Result<RecommendationStrategy, ValidationError> {
    if (!VALID_STRATEGIES.includes(value as RecommendationStrategyValue)) {
      return err(
        new ValidationError("Invalid recommendation strategy", [
          { field: "strategy", message: `must be one of ${VALID_STRATEGIES.join(", ")}` },
        ]),
      );
    }
    return ok(new RecommendationStrategy({ value: value as RecommendationStrategyValue }));
  }

  get value(): RecommendationStrategyValue {
    return this.props.value;
  }
}
