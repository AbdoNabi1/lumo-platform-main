import { ValidationError, ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";

interface RoleNameProps {
  readonly value: string;
}

const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * A bare reference to a role by name — Identity never defines or evaluates roles/permissions
 * (owned by Keto, ADR-0007/0023); `Membership` only carries which name applies.
 */
export class RoleName extends ValueObject<RoleNameProps> {
  static create(value: string): Result<RoleName, ValidationError> {
    const normalized = value.trim().toLowerCase();
    if (!ROLE_NAME_PATTERN.test(normalized)) {
      return err(
        new ValidationError("Invalid role name", [
          { field: "roleName", message: "must be a lower_snake_case identifier" },
        ]),
      );
    }
    return ok(new RoleName({ value: normalized }));
  }

  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}
