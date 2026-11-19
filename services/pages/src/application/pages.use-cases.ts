import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ConcurrencyError, ConflictError, NotFoundError } from "@platform/utils";
import { invalidContent, pageNotFound, routePathTaken, versionConflict } from "../domain/errors";
import { Page, type PageStatusValue } from "../domain/page";
import { validatePageContent } from "../domain/page-content";
import type { PageRepository, TemplateRepository } from "../domain/repositories";
import { Template } from "../domain/template";
import { RoutePath } from "../domain/value-objects/route-path";

export interface PagesDeps {
  readonly pages: PageRepository;
  readonly templates: TemplateRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface CreatePageInput {
  readonly name: string;
  readonly routePath: string;
  readonly templateRef?: string;
  readonly experienceRef?: string;
  readonly seoProfileRef?: string;
  readonly localeRef?: string;
  readonly title?: unknown;
  readonly body?: unknown;
  readonly metaDescription?: unknown;
  readonly tenantId: string;
}

export interface PageStatusOutput {
  readonly pageId: string;
  readonly status: string;
}

/** Creates a page in `draft` status — one per `routePath`. */
export class CreatePage implements UseCase<CreatePageInput, PageStatusOutput, DomainError> {
  private readonly deps: PagesDeps;

  constructor(deps: PagesDeps) {
    this.deps = deps;
  }

  async execute(input: CreatePageInput): Promise<Result<PageStatusOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);
    const routePath = RoutePath.create(input.routePath);
    if (!routePath.ok) return err(routePath.error);
    // Everything is validated before the first write: the unit of work commits on an `err`.
    const content = validatePageContent(input);
    if (!content.ok) return err(invalidContent(content.issues));

    return this.deps.unitOfWork.run<Result<PageStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.pages.findByRoutePath(input.routePath, input.tenantId, tx);
      if (existing !== null) return err(routePathTaken(input.routePath));
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const page = Page.create(
        id,
        input.name,
        routePath.value,
        {
          templateRef: input.templateRef,
          experienceRef: input.experienceRef,
          seoProfileRef: input.seoProfileRef,
          localeRef: input.localeRef,
        },
        content.value,
        this.deps.clock.now(),
      );
      await this.deps.pages.save(page, input.tenantId, tx);
      return ok({ pageId: id.toString(), status: page.status });
    });
  }
}

export interface PageIdInput {
  readonly pageId: string;
  readonly tenantId: string;
}

export interface AdvancePageInput extends PageIdInput {
  readonly toStatus: PageStatusValue;
}

/** Generic validated transition — used for publish/archive. */
export class AdvancePage implements UseCase<AdvancePageInput, PageStatusOutput, DomainError> {
  private readonly deps: PagesDeps;

  constructor(deps: PagesDeps) {
    this.deps = deps;
  }

  async execute(input: AdvancePageInput): Promise<Result<PageStatusOutput, DomainError>> {
    try {
      return await this.deps.unitOfWork.run<Result<PageStatusOutput, DomainError>>(async (tx) => {
        const page = await this.deps.pages.findById(input.pageId, input.tenantId, tx);
        if (page === null) return err(pageNotFound());

        try {
          page.transition(input.toStatus, this.deps.idGenerator.generate(), this.deps.clock.now());
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.pages.save(page, input.tenantId, tx);
        return ok({ pageId: page.id.toString(), status: page.status });
      });
    } catch (error) {
      // A content save or another transition won the race: the unit of work rolled back.
      if (error instanceof ConcurrencyError) return err(versionConflict());
      throw error;
    }
  }
}

export interface UpdatePageContentInput {
  readonly pageId: string;
  readonly title: unknown;
  readonly body: unknown;
  readonly metaDescription: unknown;
  readonly expectedVersion: number;
  readonly tenantId: string;
}

export interface UpdatePageContentOutput {
  readonly pageId: string;
  readonly version: number;
}

/** Replaces a page's title, body and meta description (draft or published; version-guarded). */
export class UpdatePageContent implements UseCase<
  UpdatePageContentInput,
  UpdatePageContentOutput,
  DomainError
> {
  private readonly deps: PagesDeps;

  constructor(deps: PagesDeps) {
    this.deps = deps;
  }

  async execute(
    input: UpdatePageContentInput,
  ): Promise<Result<UpdatePageContentOutput, DomainError>> {
    // Validate everything before the first write: the unit of work commits on an `err`.
    const content = validatePageContent(input);
    if (!content.ok) return err(invalidContent(content.issues));

    try {
      return await this.deps.unitOfWork.run<Result<UpdatePageContentOutput, DomainError>>(
        async (tx) => {
          const page = await this.deps.pages.findById(input.pageId, input.tenantId, tx);
          if (page === null) return err(pageNotFound());
          if (page.version !== input.expectedVersion) return err(versionConflict());
          try {
            page.updateContent(content.value, this.deps.clock.now());
          } catch (error) {
            if (isDomainError(error)) return err(error);
            throw error;
          }
          await this.deps.pages.save(page, input.tenantId, tx);
          return ok({ pageId: page.id.toString(), version: page.version + 1 });
        },
      );
    } catch (error) {
      if (error instanceof ConcurrencyError) return err(versionConflict());
      throw error;
    }
  }
}

export interface CreateTemplateInput {
  readonly name: string;
  readonly experienceRef: string;
  readonly tenantId: string;
}

export interface TemplateStatusOutput {
  readonly templateId: string;
  readonly status: string;
}

/** Creates a reusable template — one per `name`. */
export class CreateTemplate implements UseCase<
  CreateTemplateInput,
  TemplateStatusOutput,
  DomainError
> {
  private readonly deps: PagesDeps;

  constructor(deps: PagesDeps) {
    this.deps = deps;
  }

  async execute(input: CreateTemplateInput): Promise<Result<TemplateStatusOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<TemplateStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.templates.findByName(input.name, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Template "${input.name}" already exists`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const template = Template.create(id, input.name, input.experienceRef);
      await this.deps.templates.save(template, input.tenantId, tx);
      return ok({ templateId: id.toString(), status: template.status });
    });
  }
}

export interface TemplateIdInput {
  readonly templateId: string;
  readonly tenantId: string;
}

/** Archives a template. */
export class ArchiveTemplate implements UseCase<
  TemplateIdInput,
  TemplateStatusOutput,
  DomainError
> {
  private readonly deps: PagesDeps;

  constructor(deps: PagesDeps) {
    this.deps = deps;
  }

  async execute(input: TemplateIdInput): Promise<Result<TemplateStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<TemplateStatusOutput, DomainError>>(async (tx) => {
      const template = await this.deps.templates.findById(input.templateId, input.tenantId, tx);
      if (template === null) return err(new NotFoundError("Template not found"));

      try {
        template.archive(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.templates.save(template, input.tenantId, tx);
      return ok({ templateId: template.id.toString(), status: template.status });
    });
  }
}
