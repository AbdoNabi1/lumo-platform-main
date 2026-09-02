import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { SecurityChanged, type SecurityEventName } from "./events/security-changed.event";
import { PermissionSpec } from "./value-objects/permission-spec";
import { SecurityScope, type SecurityScopeProps } from "./value-objects/security-scope";

export const ROLE_STATUSES = ["active", "archived"] as const;
export type RoleStatus = (typeof ROLE_STATUSES)[number];

interface RoleProps {
  readonly key: string;
  name: string;
  scope: SecurityScope;
  /** Granted permissions as `<resource>:<action>` strings (validated on grant). */
  permissions: string[];
  /** Parent role key for permission inheritance, or null (a DAG walked by the evaluator). */
  parentKey: string | null;
  readonly isTemplate: boolean;
  status: RoleStatus;
}

/**
 * A **role** — a named, reusable set of permissions in the Security Registry. Roles are **scoped**
 * (org/tenant/workspace/environment), support **inheritance** via `parentKey`, and may be
 * **templates** (cloned per tenant). RBAC today; ABAC composes via policy conditions and ReBAC via
 * the resource model — no redesign needed (ADR-0023, sprint Part 2).
 */
export class Role extends AggregateRoot<RoleProps> {
  static define(
    id: UniqueEntityId,
    input: {
      readonly key: string;
      readonly name: string;
      readonly scope?: SecurityScopeProps;
      readonly permissions?: readonly string[];
      readonly parentKey?: string | null;
      readonly isTemplate?: boolean;
    },
    eventId: string,
    occurredAt: Date,
  ): Role {
    if (input.key.trim().length === 0) throw new BusinessRuleError("A role needs a key");
    if (input.name.trim().length === 0) throw new BusinessRuleError("A role needs a name");
    const permissions = normalizePermissions(input.permissions ?? []);
    const role = new Role(
      {
        key: input.key.trim(),
        name: input.name.trim(),
        scope: input.scope === undefined ? SecurityScope.platform() : SecurityScope.of(input.scope),
        permissions,
        parentKey: input.parentKey ?? null,
        isTemplate: input.isTemplate ?? false,
        status: "active",
      },
      id,
    );
    role.emit("security.role.defined", eventId, occurredAt);
    return role;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: {
      readonly key: string;
      readonly name: string;
      readonly scope: SecurityScope;
      readonly permissions: readonly string[];
      readonly parentKey: string | null;
      readonly isTemplate: boolean;
      readonly status: RoleStatus;
      readonly version: number;
    },
  ): Role {
    return new Role(
      {
        key: base.key,
        name: base.name,
        scope: base.scope,
        permissions: [...base.permissions],
        parentKey: base.parentKey,
        isTemplate: base.isTemplate,
        status: base.status,
      },
      id,
      base.version,
    );
  }

  grantPermission(permission: string, eventId: string, occurredAt: Date): void {
    this.ensureActive();
    const spec = PermissionSpec.parse(permission);
    if (!spec.ok) throw new BusinessRuleError(spec.error.message);
    const value = spec.value.toString();
    if (!this.props.permissions.includes(value)) {
      this.props.permissions = [...this.props.permissions, value].sort();
      this.emit("security.role.defined", eventId, occurredAt);
    }
  }

  revokePermission(permission: string, eventId: string, occurredAt: Date): void {
    this.ensureActive();
    if (this.props.permissions.includes(permission)) {
      this.props.permissions = this.props.permissions.filter((p) => p !== permission);
      this.emit("security.role.defined", eventId, occurredAt);
    }
  }

  archive(eventId: string, occurredAt: Date): void {
    if (this.props.status === "archived") return;
    this.props.status = "archived";
    this.emit("security.role.defined", eventId, occurredAt);
  }

  get key(): string {
    return this.props.key;
  }
  get name(): string {
    return this.props.name;
  }
  get scope(): SecurityScope {
    return this.props.scope;
  }
  get permissions(): readonly string[] {
    return this.props.permissions;
  }
  get parentKey(): string | null {
    return this.props.parentKey;
  }
  get isTemplate(): boolean {
    return this.props.isTemplate;
  }
  get status(): RoleStatus {
    return this.props.status;
  }

  private ensureActive(): void {
    if (this.props.status !== "active")
      throw new BusinessRuleError("An archived role cannot be modified");
  }

  private emit(event: SecurityEventName, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new SecurityChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          aggregateId: this.id.toString(),
          aggregate: "role",
          key: this.props.key,
          event,
          status: this.props.status,
        },
      ),
    );
  }
}

function normalizePermissions(permissions: readonly string[]): string[] {
  const out = new Set<string>();
  for (const permission of permissions) {
    const spec = PermissionSpec.parse(permission);
    if (!spec.ok)
      throw new BusinessRuleError(`Invalid permission "${permission}": ${spec.error.message}`);
    out.add(spec.value.toString());
  }
  return [...out].sort();
}
