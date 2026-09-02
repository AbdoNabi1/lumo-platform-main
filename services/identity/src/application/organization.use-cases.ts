import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConflictError, type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { OrganizationRepository } from "../domain/access-repositories";
import { Organization } from "../domain/organization";
import { OrganizationSlug } from "../domain/value-objects/organization-slug";

export interface OrganizationUseCaseDeps {
  readonly organizations: OrganizationRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface CreateOrganizationInput {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
}

export interface CreateOrganizationOutput {
  readonly organizationId: string;
}

/** Creates a new organization (slug is the natural key, unique per tenant). */
export class CreateOrganization implements UseCase<
  CreateOrganizationInput,
  CreateOrganizationOutput,
  DomainError
> {
  private readonly deps: OrganizationUseCaseDeps;

  constructor(deps: OrganizationUseCaseDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreateOrganizationInput,
  ): Promise<Result<CreateOrganizationOutput, DomainError>> {
    const slug = OrganizationSlug.create(input.slug);
    if (!slug.ok) return err(slug.error);
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<CreateOrganizationOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.organizations.findBySlug(
        slug.value.value,
        input.tenantId,
        tx,
      );
      if (existing !== null) {
        return err(
          new ConflictError("An organization with this slug already exists in this tenant"),
        );
      }

      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const organization = Organization.create(
        id,
        input.tenantId,
        slug.value,
        input.name,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.organizations.save(organization, tx);
      return ok({ organizationId: id.toString() });
    });
  }
}

export interface ArchiveOrganizationInput {
  readonly tenantId: string;
  readonly organizationId: string;
}

export interface ArchiveOrganizationOutput {
  readonly organizationId: string;
}

/** Archives an organization. */
export class ArchiveOrganization implements UseCase<
  ArchiveOrganizationInput,
  ArchiveOrganizationOutput,
  DomainError
> {
  private readonly deps: OrganizationUseCaseDeps;

  constructor(deps: OrganizationUseCaseDeps) {
    this.deps = deps;
  }

  async execute(
    input: ArchiveOrganizationInput,
  ): Promise<Result<ArchiveOrganizationOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ArchiveOrganizationOutput, DomainError>>(async (tx) => {
      const organization = await this.deps.organizations.findById(
        input.organizationId,
        input.tenantId,
        tx,
      );
      if (organization === null) {
        return err(new NotFoundError("Organization not found"));
      }

      try {
        organization.archive();
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.organizations.save(organization, tx);
      return ok({ organizationId: organization.id.toString() });
    });
  }
}
