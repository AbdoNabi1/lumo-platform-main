import type { UseCase } from "@platform/application";
import { isDomainError, UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError } from "@platform/utils";
import { Role } from "../domain/role";
import { RoleAssignment } from "../domain/role-assignment";
import type { SecurityScopeProps } from "../domain/value-objects/security-scope";
import { recordAudit, type SecurityDeps } from "./deps";

export interface RoleOutput {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly parentKey: string | null;
  readonly isTemplate: boolean;
  readonly status: string;
  readonly scope: string;
}

function presentRole(r: Role): RoleOutput {
  return {
    id: r.id.toString(),
    key: r.key,
    name: r.name,
    permissions: [...r.permissions],
    parentKey: r.parentKey,
    isTemplate: r.isTemplate,
    status: r.status,
    scope: r.scope.key(),
  };
}

export interface DefineRoleInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly key: string;
  readonly name: string;
  readonly scope?: SecurityScopeProps;
  readonly permissions?: readonly string[];
  readonly parentKey?: string | null;
  readonly isTemplate?: boolean;
}

/** Defines a role in the registry (idempotent per key). Supports inheritance, scope, templates. */
export class DefineRole implements UseCase<DefineRoleInput, RoleOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: DefineRoleInput): Promise<Result<RoleOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<RoleOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.roles.findByKey(input.key, input.tenantId, tx);
      if (existing !== null) return ok(presentRole(existing));
      let role: Role;
      try {
        role = Role.define(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          input,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.roles.save(role, input.tenantId, tx);
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: "system",
        action: "security.role.defined",
        decision: "allow",
        metadata: { role: role.key },
      });
      return ok(presentRole(role));
    });
  }
}

export interface GrantRolePermissionInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly roleKey: string;
  readonly permission: string;
}

/** Adds a permission to a role (permission sets). Emits `security.role.defined` + audit. */
export class GrantRolePermission implements UseCase<
  GrantRolePermissionInput,
  RoleOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: GrantRolePermissionInput): Promise<Result<RoleOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<RoleOutput, DomainError>>(async (tx) => {
      const role = await this.deps.roles.findByKey(input.roleKey, input.tenantId, tx);
      if (role === null) return err(new NotFoundError("Role not found"));
      try {
        role.grantPermission(
          input.permission,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.roles.save(role, input.tenantId, tx);
      this.deps.telemetry.increment("security.permission.granted");
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: "system",
        action: "security.permission.granted",
        decision: "allow",
        metadata: { role: role.key, permission: input.permission },
      });
      return ok(presentRole(role));
    });
  }
}

export interface AssignmentOutput {
  readonly id: string;
  readonly principalRef: string;
  readonly roleKey: string;
  readonly status: string;
  readonly scope: string;
  readonly grantedBy: string;
  readonly expiresAt: string | null;
}

function presentAssignment(a: RoleAssignment): AssignmentOutput {
  return {
    id: a.id.toString(),
    principalRef: a.principalRef,
    roleKey: a.roleKey,
    status: a.status,
    scope: a.scope.key(),
    grantedBy: a.grantedBy,
    expiresAt: a.expiresAt === null ? null : a.expiresAt.toISOString(),
  };
}

export interface AssignRoleInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly principalExternalId: string;
  readonly roleKey: string;
  readonly grantedBy: string;
  readonly scope?: SecurityScopeProps;
  /** Temporary elevation / JIT: seconds until the grant auto-expires (omit for a standing grant). */
  readonly ttlSeconds?: number;
  readonly reason?: string;
}

/**
 * Assigns a role to a principal (delegated administration via `grantedBy`; JIT/temporary elevation
 * via `ttlSeconds`). Verifies the principal + role exist. Emits `security.role.assigned` + audit.
 */
export class AssignRole implements UseCase<AssignRoleInput, AssignmentOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: AssignRoleInput): Promise<Result<AssignmentOutput, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(
      input.principalExternalId,
      input.tenantId,
    );
    if (principal === null) return err(new NotFoundError("Principal not found"));
    const role = await this.deps.roles.findByKey(input.roleKey, input.tenantId);
    if (role === null) return err(new NotFoundError("Role not found"));
    if (role.status !== "active") return err(new ConflictError("Cannot assign an archived role"));
    return this.deps.unitOfWork.run<Result<AssignmentOutput, DomainError>>(async (tx) => {
      const now = this.deps.clock.now();
      const expiresAt =
        input.ttlSeconds !== undefined ? new Date(now.getTime() + input.ttlSeconds * 1000) : null;
      let assignment: RoleAssignment;
      try {
        assignment = RoleAssignment.grant(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          {
            principalRef: principal.id.toString(),
            roleKey: role.key,
            grantedBy: input.grantedBy,
            scope: input.scope,
            expiresAt,
            reason: input.reason ?? null,
          },
          this.deps.idGenerator.generate(),
          now,
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.assignments.save(assignment, input.tenantId, tx);
      this.deps.telemetry.increment("security.permission.granted");
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: principal.externalId,
        action: "security.role.assigned",
        decision: "allow",
        tenantRef: principal.tenantRef,
        metadata: {
          role: role.key,
          grantedBy: input.grantedBy,
          temporary: String(expiresAt !== null),
        },
      });
      return ok(presentAssignment(assignment));
    });
  }
}

export interface RevokeRoleAssignmentInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly assignmentId: string;
}

/** Revokes a role assignment. Emits `security.role.revoked` + audit. */
export class RevokeRoleAssignment implements UseCase<
  RevokeRoleAssignmentInput,
  AssignmentOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: RevokeRoleAssignmentInput): Promise<Result<AssignmentOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<AssignmentOutput, DomainError>>(async (tx) => {
      const assignment = await this.deps.assignments.findById(
        input.assignmentId,
        input.tenantId,
        tx,
      );
      if (assignment === null) return err(new NotFoundError("Assignment not found"));
      assignment.revoke(this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.assignments.save(assignment, input.tenantId, tx);
      this.deps.telemetry.increment("security.permission.revoked");
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: assignment.principalRef,
        action: "security.role.revoked",
        decision: "allow",
        metadata: { role: assignment.roleKey },
      });
      return ok(presentAssignment(assignment));
    });
  }
}
