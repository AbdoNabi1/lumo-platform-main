import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { TemplateRepository } from "../domain/repositories";
import type { Template } from "../domain/template";
import type { TemplateIdInput } from "./pages.use-cases";

export interface GetTemplateDeps {
  readonly templates: TemplateRepository;
}

/** Fetches a single template by id. */
export class GetTemplate implements UseCase<TemplateIdInput, Template, DomainError> {
  private readonly deps: GetTemplateDeps;

  constructor(deps: GetTemplateDeps) {
    this.deps = deps;
  }

  async execute(input: TemplateIdInput): Promise<Result<Template, DomainError>> {
    const template = await this.deps.templates.findById(input.templateId);
    return template === null ? err(new NotFoundError("Template not found")) : ok(template);
  }
}
