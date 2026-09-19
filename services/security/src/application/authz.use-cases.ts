import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError } from "@platform/utils";
import type { AbacCondition, AbacMismatch } from "../domain/abac";
import { RelationTuple } from "../domain/relationship";
import { PermissionSpec } from "../domain/value-objects/permission-spec";
import { SecurityScope, type SecurityScopeProps } from "../domain/value-objects/security-scope";
import { loadRoleClosure } from "./authz-helpers";
import { recordAudit, securityEvent, type SecurityDeps } from "./deps";

export interface RelationTupleInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly namespace: string;
  readonly object: string;
  readonly relation: string;
  /** A direct subject id (principal external id) or a subject-set `object#relation`. */
  readonly subject: string;
}

export interface RelationTupleOutput {
  readonly key: string;
}

/** Writes a ReBAC relation tuple (idempotent by key). Emits `security.relation.written` + audit (§16). */
export class WriteRelationTuple implements UseCase<
  RelationTupleInput,
  RelationTupleOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: RelationTupleInput): Promise<Result<RelationTupleOutput, DomainError>> {
    const tuple = new RelationTuple({
      id: this.deps.idGenerator.generate(),
      namespace: input.namespace,
      object: input.object,
      relation: input.relation,
      subject: input.subject,
    });
    return this.deps.unitOfWork.run<Result<RelationTupleOutput, DomainError>>(async (tx) => {
      await this.deps.relationTuples.put(tuple, input.tenantId, tx);
      await this.deps.outbox.publish(
        [
          securityEvent(
            this.deps,
            "relation",
            tuple.id,
            tuple.key(),
            "security.relation.written",
            "written",
          ),
        ],
        input.tenantId,
        tx,
      );
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: "system",
        action: "security.relation.written",
        decision: "allow",
        metadata: { tuple: tuple.key() },
      });
      return ok({ key: tuple.key() });
    });
  }
}

export interface DeleteRelationTupleOutput {
  readonly removed: boolean;
}

/** Removes a ReBAC relation tuple by its components. Emits `security.relation.deleted` + audit (§16). */
export class DeleteRelationTuple implements UseCase<
  RelationTupleInput,
  DeleteRelationTupleOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(
    input: RelationTupleInput,
  ): Promise<Result<DeleteRelationTupleOutput, DomainError>> {
    const key = new RelationTuple({ id: "lookup", ...input }).key();
    return this.deps.unitOfWork.run<Result<DeleteRelationTupleOutput, DomainError>>(async (tx) => {
      const removed = await this.deps.relationTuples.remove(key, input.tenantId, tx);
      if (removed) {
        await this.deps.outbox.publish(
          [
            securityEvent(
              this.deps,
              "relation",
              this.deps.idGenerator.generate(),
              key,
              "security.relation.deleted",
              "deleted",
            ),
          ],
          input.tenantId,
          tx,
        );
        await recordAudit(this.deps, tx, {
          tenantId: input.tenantId,
          principalRef: "system",
          action: "security.relation.deleted",
          decision: "allow",
          metadata: { tuple: key },
        });
      }
      return ok({ removed });
    });
  }
}

export interface CheckAccessInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly principalExternalId: string;
  readonly permission: string;
  readonly scope?: SecurityScopeProps;
  // ReBAC dimension (all three required to consult relationships)
  readonly namespace?: string;
  readonly object?: string;
  readonly relation?: string;
  // ABAC dimension
  readonly abac?: AbacCondition;
  readonly resourceAttributes?: Readonly<Record<string, string>>;
  readonly environmentAttributes?: Readonly<Record<string, string>>;
}

export interface AccessModelDecision {
  readonly allowed: boolean;
  /** Which model(s) granted the permission (empty ⇒ denied at the grant stage). */
  readonly grantedBy: readonly ("rbac" | "rebac")[];
  readonly abacSatisfied: boolean;
  readonly abacMismatches: readonly AbacMismatch[];
  readonly reasons: readonly string[];
}

/**
 * The **unified authorization check** (sprint P2.0-C §16) — one decision across **RBAC** (roles +
 * inheritance + scope), **ReBAC** (relationship tuples via {@link RelationshipCheckPort}), **ABAC**
 * (attribute constraints) and, upstream, **PBAC** (the zero-trust policy in `EvaluateAccess`). A
 * principal is granted when RBAC **or** ReBAC yields the permission **and** all ABAC constraints hold.
 * Security decides; enforcement stays at the existing points. Every check is WORM-audited.
 */
export class CheckAccess implements UseCase<CheckAccessInput, AccessModelDecision, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: CheckAccessInput): Promise<Result<AccessModelDecision, DomainError>> {
    const requiredSpec = PermissionSpec.parse(input.permission);
    if (!requiredSpec.ok) return err(requiredSpec.error);
    const now = this.deps.clock.now();
    const principal = await this.deps.principals.findByExternalId(
      input.principalExternalId,
      input.tenantId,
    );
    if (principal === null) {
      return ok({
        allowed: false,
        grantedBy: [],
        abacSatisfied: false,
        abacMismatches: [],
        reasons: ["unknown principal"],
      });
    }

    // RBAC
    const requestScope =
      input.scope === undefined ? SecurityScope.platform() : SecurityScope.of(input.scope);
    const assignments = await this.deps.assignments.listByPrincipal(
      principal.id.toString(),
      input.tenantId,
    );
    const roles = await loadRoleClosure(
      this.deps.roles,
      assignments.map((a) => a.roleKey),
      input.tenantId,
    );
    const effective = this.deps.authorization.resolve({ assignments, roles, requestScope, now });
    const rbacGranted = this.deps.authorization.isAuthorized(effective, requiredSpec.value);

    // ReBAC
    let rebacGranted = false;
    if (
      input.namespace !== undefined &&
      input.object !== undefined &&
      input.relation !== undefined
    ) {
      rebacGranted = await this.deps.relationshipCheck.check(
        {
          namespace: input.namespace,
          object: input.object,
          relation: input.relation,
          subjectId: principal.externalId,
        },
        input.tenantId,
      );
    }

    // ABAC
    const abacResult =
      input.abac === undefined
        ? { satisfied: true, mismatches: [] as readonly AbacMismatch[] }
        : this.deps.attributeEvaluator.evaluate(input.abac, {
            principal: principal.attributes,
            resource: input.resourceAttributes ?? {},
            environment: input.environmentAttributes ?? {},
          });

    const grantedBy: ("rbac" | "rebac")[] = [];
    if (rbacGranted) grantedBy.push("rbac");
    if (rebacGranted) grantedBy.push("rebac");
    const permissionGranted = grantedBy.length > 0;
    const allowed = permissionGranted && abacResult.satisfied;

    const reasons: string[] = [];
    if (!permissionGranted) reasons.push("permission not granted by RBAC or ReBAC");
    if (!abacResult.satisfied)
      reasons.push(
        `ABAC constraint failed: ${abacResult.mismatches.map((m) => `${m.dimension}.${m.attribute}`).join(", ")}`,
      );
    if (allowed) reasons.push(`granted by ${grantedBy.join("+")}`);

    return this.deps.unitOfWork.run<Result<AccessModelDecision, DomainError>>(async (tx) => {
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: principal.externalId,
        action: requiredSpec.value.toString(),
        decision: allowed ? "allow" : "deny",
        tenantRef: principal.tenantRef,
        metadata: { models: grantedBy.join("+") || "none", abac: String(abacResult.satisfied) },
      });
      return ok({
        allowed,
        grantedBy,
        abacSatisfied: abacResult.satisfied,
        abacMismatches: abacResult.mismatches,
        reasons,
      });
    });
  }
}
