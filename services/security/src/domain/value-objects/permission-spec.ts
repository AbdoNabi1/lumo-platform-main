import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

export interface PermissionSpecProps {
  readonly resource: string;
  readonly action: string;
}

const TOKEN = /^[a-z0-9][a-z0-9_-]*$|^\*$/;

/**
 * A single permission, `"<resource>:<action>"` (docs/architecture/07, `@platform/contracts`
 * `Permission`). Either segment may be `*` (grant wildcard). A held permission **implies** a
 * required one when its resource and action each equal or wildcard the required — the RBAC/ABAC
 * matching primitive consumed by the {@link AuthorizationEvaluator}.
 */
export class PermissionSpec extends ValueObject<PermissionSpecProps> {
  private constructor(props: PermissionSpecProps) {
    super(props);
  }

  static parse(permission: string): Result<PermissionSpec, ValidationError> {
    const parts = permission.split(":");
    if (parts.length !== 2) {
      return err(
        new ValidationError("permission is malformed", [
          { field: "permission", message: "expected <resource>:<action>" },
        ]),
      );
    }
    const [resource, action] = parts as [string, string];
    if (!TOKEN.test(resource) || !TOKEN.test(action)) {
      return err(
        new ValidationError("permission has invalid segment", [
          { field: "permission", message: "segments must be [a-z0-9_-]+ or *" },
        ]),
      );
    }
    return ok(new PermissionSpec({ resource, action }));
  }

  get resource(): string {
    return this.props.resource;
  }
  get action(): string {
    return this.props.action;
  }

  override toString(): string {
    return `${this.props.resource}:${this.props.action}`;
  }

  /** True when holding THIS permission satisfies `required` (wildcards widen the grant). */
  implies(required: PermissionSpec): boolean {
    const seg = (held: string, need: string): boolean => held === "*" || held === need;
    return (
      seg(this.props.resource, required.props.resource) &&
      seg(this.props.action, required.props.action)
    );
  }
}
