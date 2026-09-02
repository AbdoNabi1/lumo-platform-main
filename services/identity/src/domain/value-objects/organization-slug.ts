import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface OrganizationSlugProps {
  readonly value: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** An organization's URL-safe identifier — the natural key for lookups, unique per tenant. */
export class OrganizationSlug extends ValueObject<OrganizationSlugProps> {
  static create(value: string): Result<OrganizationSlug, ValidationError> {
    const normalized = value.trim().toLowerCase();
    if (!SLUG_PATTERN.test(normalized)) {
      return err(
        new ValidationError("Invalid organization slug", [
          {
            field: "slug",
            message: "must be lowercase alphanumeric segments separated by hyphens",
          },
        ]),
      );
    }
    return ok(new OrganizationSlug({ value: normalized }));
  }

  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
