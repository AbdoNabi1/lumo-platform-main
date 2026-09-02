import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface CategoryRefProps {
  readonly categoryId: string;
}

/** A reference to a {@link Category} by bare id — no FK across aggregates. */
export class CategoryRef extends ValueObject<CategoryRefProps> {
  static create(categoryId: string): Result<CategoryRef, ValidationError> {
    const guarded = Guard.againstEmpty(categoryId, "categoryId");
    return guarded.ok ? ok(new CategoryRef({ categoryId })) : err(guarded.error);
  }

  get categoryId(): string {
    return this.props.categoryId;
  }
}
