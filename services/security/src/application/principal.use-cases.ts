import type { UseCase } from "@platform/application";
import { isDomainError, UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, BusinessRuleError, NotFoundError } from "@platform/utils";
import { Principal } from "../domain/principal";
import { isHumanKind, type PrincipalKind } from "../domain/value-objects/principal-kind";
import { recordAudit, type SecurityDeps } from "./deps";

export interface PrincipalOutput {
  readonly id: string;
  readonly externalId: string;
  readonly kind: string;
  readonly status: string;
  readonly subjectRef?: string;
  readonly tenantRef?: string;
}

export function presentPrincipal(p: Principal): PrincipalOutput {
  return {
    id: p.id.toString(),
    externalId: p.externalId,
    kind: p.kind,
    status: p.status,
    ...(p.subjectRef !== null ? { subjectRef: p.subjectRef } : {}),
    ...(p.tenantRef !== null ? { tenantRef: p.tenantRef } : {}),
  };
}

export interface RegisterPrincipalInput {
  readonly externalId: string;
  readonly kind: PrincipalKind;
  readonly displayName: string;
  readonly subjectRef?: string | null;
  readonly tenantRef?: string | null;
  readonly attributes?: Readonly<Record<string, string>>;
}

/**
 * Registers a principal (idempotent per `externalId`). A `human` principal must reference an
 * existing Identity subject (verified via {@link IdentityDirectoryPort}); non-human principals are
 * owned outright. Emits `security.principal.registered` and a WORM audit record.
 */
export class RegisterPrincipal implements UseCase<
  RegisterPrincipalInput,
  PrincipalOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: RegisterPrincipalInput): Promise<Result<PrincipalOutput, DomainError>> {
    if (isHumanKind(input.kind)) {
      const subjectRef = input.subjectRef ?? null;
      if (subjectRef === null)
        return err(new BusinessRuleError("A human principal requires a subjectRef"));
      if (!(await this.deps.identityDirectory.exists(subjectRef))) {
        return err(new NotFoundError("Referenced Identity subject does not exist"));
      }
    }
    return this.deps.unitOfWork.run<Result<PrincipalOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.principals.findByExternalId(input.externalId, tx);
      if (existing !== null) return ok(presentPrincipal(existing));
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      let principal: Principal;
      try {
        principal = Principal.register(
          id,
          input,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.principals.save(principal, tx);
      await recordAudit(this.deps, tx, {
        principalRef: principal.externalId,
        action: "security.principal.registered",
        decision: "allow",
        tenantRef: principal.tenantRef,
        metadata: { kind: principal.kind },
      });
      return ok(presentPrincipal(principal));
    });
  }
}

export interface TransitionPrincipalInput {
  readonly externalId: string;
  readonly to: "suspended" | "active" | "disabled";
}

/** Advances a principal's lifecycle (suspend / activate / disable) with audit. */
export class TransitionPrincipal implements UseCase<
  TransitionPrincipalInput,
  PrincipalOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: TransitionPrincipalInput): Promise<Result<PrincipalOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<PrincipalOutput, DomainError>>(async (tx) => {
      const principal = await this.deps.principals.findByExternalId(input.externalId, tx);
      if (principal === null) return err(new NotFoundError("Principal not found"));
      const eventId = this.deps.idGenerator.generate();
      const now = this.deps.clock.now();
      try {
        if (input.to === "suspended") principal.suspend(eventId, now);
        else if (input.to === "active") principal.activate(eventId, now);
        else principal.disable(eventId, now);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.principals.save(principal, tx);
      await recordAudit(this.deps, tx, {
        principalRef: principal.externalId,
        action: `security.principal.${input.to}`,
        decision: "allow",
        tenantRef: principal.tenantRef,
      });
      return ok(presentPrincipal(principal));
    });
  }
}
