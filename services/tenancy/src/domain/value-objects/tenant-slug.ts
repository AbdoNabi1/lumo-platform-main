import { Guard, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface TenantSlugProps {
  readonly value: string;
}

/** A tenant's globally-unique, URL-safe slug (ADR-0008 Sprint-5.5 addendum). */
export class TenantSlug extends ValueObject<TenantSlugProps> {
  static create(value: string): Result<TenantSlug, ValidationError> {
    const guarded = Guard.againstEmpty(value, "slug");
    if (!guarded.ok) return err(guarded.error);
    if (!SLUG_PATTERN.test(value)) {
      return err(
        new ValidationError("Invalid tenant slug", [
          { field: "slug", message: "must be lowercase alphanumeric, hyphen-separated" },
        ]),
      );
    }
    return ok(new TenantSlug({ value }));
  }

  get value(): string {
    return this.props.value;
  }
}
