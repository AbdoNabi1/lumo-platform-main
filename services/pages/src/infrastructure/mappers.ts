import { UniqueEntityId } from "@platform/domain";
import { Page, type PageStatusValue } from "../domain/page";
import { Template, type TemplateStatusValue } from "../domain/template";
import { RoutePath } from "../domain/value-objects/route-path";

export interface PageRow {
  readonly id: string;
  readonly name: string;
  readonly routePath: string;
  readonly templateRef: string | null;
  readonly experienceRef: string | null;
  readonly seoProfileRef: string | null;
  readonly localeRef: string | null;
  readonly status: string;
  readonly version: number;
}

export interface TemplateRow {
  readonly id: string;
  readonly name: string;
  readonly experienceRef: string;
  readonly status: string;
  readonly version: number;
}

export class PageMapper {
  static toDomain(row: PageRow): Page {
    const routePath = RoutePath.create(row.routePath);
    if (!routePath.ok)
      throw new Error(`Corrupt page row: invalid routePath (${routePath.error.message})`);
    return Page.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      routePath.value,
      row.status as PageStatusValue,
      row.version,
      {
        templateRef: row.templateRef ?? undefined,
        experienceRef: row.experienceRef ?? undefined,
        seoProfileRef: row.seoProfileRef ?? undefined,
        localeRef: row.localeRef ?? undefined,
      },
    );
  }

  static toRow(page: Page, tenantId: string) {
    return {
      id: page.id.toString(),
      tenantId,
      name: page.name,
      routePath: page.routePath.value,
      templateRef: page.templateRef ?? null,
      experienceRef: page.experienceRef ?? null,
      seoProfileRef: page.seoProfileRef ?? null,
      localeRef: page.localeRef ?? null,
      status: page.status,
      version: 1,
    };
  }
}

export class TemplateMapper {
  static toDomain(row: TemplateRow): Template {
    return Template.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      row.experienceRef,
      row.status as TemplateStatusValue,
      row.version,
    );
  }

  static toRow(template: Template, tenantId: string) {
    return {
      id: template.id.toString(),
      tenantId,
      name: template.name,
      experienceRef: template.experienceRef,
      status: template.status,
      version: 1,
    };
  }
}
