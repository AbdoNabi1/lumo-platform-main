import { ValueObject } from "@platform/domain";

interface ReviewMediaProps {
  readonly assetRefs: readonly string[];
}

/** Media attached to a review — bare asset refs only (Reviews owns no media data itself). */
export class ReviewMedia extends ValueObject<ReviewMediaProps> {
  static empty(): ReviewMedia {
    return new ReviewMedia({ assetRefs: [] });
  }

  static create(assetRefs: readonly string[]): ReviewMedia {
    return new ReviewMedia({ assetRefs: [...assetRefs] });
  }

  get assetRefs(): readonly string[] {
    return this.props.assetRefs;
  }
}
