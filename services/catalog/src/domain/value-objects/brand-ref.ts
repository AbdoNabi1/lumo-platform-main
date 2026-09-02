import { Guard, type ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface BrandRefProps {
  readonly brandId: string;
}

/** A reference to a {@link Brand} by bare id — same aggregate cluster, still no FK across aggregates. */
export class BrandRef extends ValueObject<BrandRefProps> {
  static create(brandId: string): Result<BrandRef, ValidationError> {
    const guarded = Guard.againstEmpty(brandId, "brandId");
    return guarded.ok ? ok(new BrandRef({ brandId })) : err(guarded.error);
  }

  get brandId(): string {
    return this.props.brandId;
  }
}
