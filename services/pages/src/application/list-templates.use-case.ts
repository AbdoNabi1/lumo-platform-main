import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { TemplateRepository } from "../domain/repositories";
import type { Template } from "../domain/template";

export interface ListTemplatesDeps {
  readonly templates: TemplateRepository;
}

/** Cursor-paginated template listing. */
export class ListTemplates implements UseCase<CursorPage, Paginated<Template>, DomainError> {
  private readonly deps: ListTemplatesDeps;

  constructor(deps: ListTemplatesDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<Template>, DomainError>> {
    return ok(await this.deps.templates.list(input));
  }
}
