import type { GetPage } from "../application/get-page.use-case";
import type { GetTemplate } from "../application/get-template.use-case";
import type { ListPages, ListPagesInput } from "../application/list-pages.use-case";
import type { ListTemplates, ListTemplatesInput } from "../application/list-templates.use-case";
import type {
  AdvancePage,
  AdvancePageInput,
  ArchiveTemplate,
  CreatePage,
  CreatePageInput,
  CreateTemplate,
  CreateTemplateInput,
  PageIdInput,
  TemplateIdInput,
  UpdatePageContent,
  UpdatePageContentInput,
} from "../application/pages.use-cases";
import type {
  GetPagesByIds,
  GetPagesByIdsInput,
  GetPublishedPageByPath,
  GetPublishedPageByPathInput,
  ListPublishedPages,
  ListPublishedPagesInput,
} from "../application/public-pages.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface PagesControllerDeps {
  readonly createPage: CreatePage;
  readonly advancePage: AdvancePage;
  readonly updatePageContent: UpdatePageContent;
  readonly createTemplate: CreateTemplate;
  readonly archiveTemplate: ArchiveTemplate;
  readonly listPages: ListPages;
  readonly getPage: GetPage;
  readonly getPublishedPageByPath: GetPublishedPageByPath;
  readonly listPublishedPages: ListPublishedPages;
  readonly getPagesByIds: GetPagesByIds;
  readonly listTemplates: ListTemplates;
  readonly getTemplate: GetTemplate;
}

/** Framework-agnostic interface boundary for pages use-cases (no HTTP server). */
export class PagesController {
  private readonly deps: PagesControllerDeps;

  constructor(deps: PagesControllerDeps) {
    this.deps = deps;
  }

  async createPage(input: CreatePageInput): Promise<ControllerResponse> {
    return present(await this.deps.createPage.execute(input), 201);
  }

  async advancePage(input: AdvancePageInput): Promise<ControllerResponse> {
    return present(await this.deps.advancePage.execute(input), 200);
  }

  async updatePageContent(input: UpdatePageContentInput): Promise<ControllerResponse> {
    return present(await this.deps.updatePageContent.execute(input), 200);
  }

  async createTemplate(input: CreateTemplateInput): Promise<ControllerResponse> {
    return present(await this.deps.createTemplate.execute(input), 201);
  }

  async archiveTemplate(input: TemplateIdInput): Promise<ControllerResponse> {
    return present(await this.deps.archiveTemplate.execute(input), 200);
  }

  async listPages(input: ListPagesInput): Promise<ControllerResponse> {
    return present(await this.deps.listPages.execute(input), 200);
  }

  async getPage(input: PageIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getPage.execute(input), 200);
  }

  /** Only a published page at `/pages/<handle>`; anything else is 404 `PAGE_NOT_FOUND`. */
  async publishedPageByPath(input: GetPublishedPageByPathInput): Promise<ControllerResponse> {
    return present(await this.deps.getPublishedPageByPath.execute(input), 200);
  }

  async listPublishedPages(input: ListPublishedPagesInput): Promise<ControllerResponse> {
    return present(await this.deps.listPublishedPages.execute(input), 200);
  }

  async getByIds(input: GetPagesByIdsInput): Promise<ControllerResponse> {
    return present(await this.deps.getPagesByIds.execute(input), 200);
  }

  async listTemplates(input: ListTemplatesInput): Promise<ControllerResponse> {
    return present(await this.deps.listTemplates.execute(input), 200);
  }

  async getTemplate(input: TemplateIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getTemplate.execute(input), 200);
  }
}
