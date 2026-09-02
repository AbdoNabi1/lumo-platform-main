import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface RatingProps {
  readonly value: number;
}

/** A 1-5 star rating. */
export class Rating extends ValueObject<RatingProps> {
  static create(value: number): Result<Rating, ValidationError> {
    const guarded = Guard.againstOutOfRange(value, 1, 5, "rating");
    if (!guarded.ok) return err(guarded.error);
    return ok(new Rating({ value }));
  }

  get value(): number {
    return this.props.value;
  }
}
