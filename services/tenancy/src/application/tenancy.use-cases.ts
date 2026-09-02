import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConflictError, NotFoundError, isDomainError } from "@platform/utils";
import { Tenant, type TenantIsolationTier } from "../domain/tenant";
import type { TenantRepository, WorkspaceRepository } from "../domain/repositories";
import { Workspace, type WorkspaceEnv } from "../domain/workspace";
import { TenantSlug } from "../domain/value-objects/tenant-slug";
import type { WorkspaceConfig } from "../domain/value-objects/workspace-config";

export interface TenancyDeps {
  readonly tenants: TenantRepository;
  readonly workspaces: WorkspaceRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface TenantIdOutput {
  readonly id: string;
}

export interface CreateTenantInput {
  readonly slug: string;
  readonly name: string;
  readonly isolationTier: TenantIsolationTier;
}

/** Creates a tenant — the merchant account/store identity. One per globally-unique `slug`. */
export class CreateTenant implements UseCase<CreateTenantInput, TenantIdOutput, DomainError> {
  private readonly deps: TenancyDeps;

  constructor(deps: TenancyDeps) {
    this.deps = deps;
  }

  async execute(input: CreateTenantInput): Promise<Result<TenantIdOutput, DomainError>> {
    const slug = TenantSlug.create(input.slug);
    if (!slug.ok) return err(slug.error);

    return this.deps.unitOfWork.run<Result<TenantIdOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.tenants.findBySlug(input.slug, tx);
      if (existing !== null) {
        return err(new ConflictError(`Tenant slug "${input.slug}" already exists`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const tenant = Tenant.create(
        id,
        slug.value,
        input.name,
        input.isolationTier,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.tenants.save(tenant, tx);
      return ok({ id: id.toString() });
    });
  }
}

export interface TenantIdInput {
  readonly tenantId: string;
}

/** Transitions a tenant's status (`activate`/`suspend`/`cancel`) via a shared use-case shape. */
abstract class TenantTransitionUseCase implements UseCase<
  TenantIdInput,
  TenantIdOutput,
  DomainError
> {
  protected readonly deps: TenancyDeps;

  constructor(deps: TenancyDeps) {
    this.deps = deps;
  }

  protected abstract apply(tenant: Tenant, eventId: string, occurredAt: Date): void;

  async execute(input: TenantIdInput): Promise<Result<TenantIdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<TenantIdOutput, DomainError>>(async (tx) => {
      const tenant = await this.deps.tenants.findById(input.tenantId, tx);
      if (tenant === null) return err(new NotFoundError("Tenant not found"));
      try {
        this.apply(tenant, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.tenants.save(tenant, tx);
      return ok({ id: tenant.id.toString() });
    });
  }
}

export class ActivateTenant extends TenantTransitionUseCase {
  protected apply(tenant: Tenant, eventId: string, occurredAt: Date): void {
    tenant.activate(eventId, occurredAt);
  }
}

export class SuspendTenant extends TenantTransitionUseCase {
  protected apply(tenant: Tenant, eventId: string, occurredAt: Date): void {
    tenant.suspend(eventId, occurredAt);
  }
}

export class CancelTenant extends TenantTransitionUseCase {
  protected apply(tenant: Tenant, eventId: string, occurredAt: Date): void {
    tenant.cancel(eventId, occurredAt);
  }
}

export interface RebrandTenantInput extends TenantIdInput {
  readonly branding: Readonly<Record<string, string>>;
}

/** Updates a tenant's white-label branding. */
export class RebrandTenant implements UseCase<RebrandTenantInput, TenantIdOutput, DomainError> {
  private readonly deps: TenancyDeps;

  constructor(deps: TenancyDeps) {
    this.deps = deps;
  }

  async execute(input: RebrandTenantInput): Promise<Result<TenantIdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<TenantIdOutput, DomainError>>(async (tx) => {
      const tenant = await this.deps.tenants.findById(input.tenantId, tx);
      if (tenant === null) return err(new NotFoundError("Tenant not found"));
      tenant.rebrand(input.branding, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.tenants.save(tenant, tx);
      return ok({ id: tenant.id.toString() });
    });
  }
}

export interface CreateWorkspaceInput {
  readonly tenantId: string;
  readonly env: WorkspaceEnv;
  readonly name: string;
}

/** Creates a workspace within a tenant — one per `(tenantRef, name)`. */
export class CreateWorkspace implements UseCase<CreateWorkspaceInput, TenantIdOutput, DomainError> {
  private readonly deps: TenancyDeps;

  constructor(deps: TenancyDeps) {
    this.deps = deps;
  }

  async execute(input: CreateWorkspaceInput): Promise<Result<TenantIdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<TenantIdOutput, DomainError>>(async (tx) => {
      const tenant = await this.deps.tenants.findById(input.tenantId, tx);
      if (tenant === null) return err(new NotFoundError("Tenant not found"));
      const existing = await this.deps.workspaces.findByTenantRefAndName(
        input.tenantId,
        input.name,
        tx,
      );
      if (existing !== null) {
        return err(new ConflictError(`Workspace "${input.name}" already exists for this tenant`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const workspace = Workspace.create(
        id,
        input.tenantId,
        input.env,
        input.name,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.workspaces.save(workspace, tx);
      return ok({ id: id.toString() });
    });
  }
}

export interface WorkspaceIdInput {
  readonly workspaceId: string;
}

/** Archives a workspace. */
export class ArchiveWorkspace implements UseCase<WorkspaceIdInput, TenantIdOutput, DomainError> {
  private readonly deps: TenancyDeps;

  constructor(deps: TenancyDeps) {
    this.deps = deps;
  }

  async execute(input: WorkspaceIdInput): Promise<Result<TenantIdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<TenantIdOutput, DomainError>>(async (tx) => {
      const workspace = await this.deps.workspaces.findById(input.workspaceId, tx);
      if (workspace === null) return err(new NotFoundError("Workspace not found"));
      try {
        workspace.archive(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.workspaces.save(workspace, tx);
      return ok({ id: workspace.id.toString() });
    });
  }
}

export interface ConfigureWorkspaceInput extends WorkspaceIdInput {
  readonly config: Parameters<WorkspaceConfig["patch"]>[0];
}

/** Patch-configures a workspace's white-label settings (Sprint-5.6 addendum §2). */
export class ConfigureWorkspace implements UseCase<
  ConfigureWorkspaceInput,
  TenantIdOutput,
  DomainError
> {
  private readonly deps: TenancyDeps;

  constructor(deps: TenancyDeps) {
    this.deps = deps;
  }

  async execute(input: ConfigureWorkspaceInput): Promise<Result<TenantIdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<TenantIdOutput, DomainError>>(async (tx) => {
      const workspace = await this.deps.workspaces.findById(input.workspaceId, tx);
      if (workspace === null) return err(new NotFoundError("Workspace not found"));
      workspace.configure(input.config, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.workspaces.save(workspace, tx);
      return ok({ id: workspace.id.toString() });
    });
  }
}
