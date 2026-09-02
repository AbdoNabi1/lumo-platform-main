import { ValueObject } from "@platform/domain";

export interface ScoredProductRef {
  readonly productRef: string;
  readonly score: number;
}

interface RecommendationSetProps {
  readonly anchorRef: string;
  readonly scoredRefs: readonly ScoredProductRef[];
  readonly generatedAt: Date;
}

/** A model's scored product set for one anchor (product/customer ref, depending on strategy) — relationships only, no product data owned here. */
export class RecommendationSet extends ValueObject<RecommendationSetProps> {
  static create(
    anchorRef: string,
    scoredRefs: readonly ScoredProductRef[],
    generatedAt: Date,
  ): RecommendationSet {
    return new RecommendationSet({ anchorRef, scoredRefs, generatedAt });
  }

  get anchorRef(): string {
    return this.props.anchorRef;
  }

  get scoredRefs(): readonly ScoredProductRef[] {
    return this.props.scoredRefs;
  }

  get generatedAt(): Date {
    return this.props.generatedAt;
  }
}
