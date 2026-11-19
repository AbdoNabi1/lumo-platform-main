import { UniqueEntityId } from "@platform/domain";
import type { LocalizedText } from "@platform/storefront-content";
import { Page, type PageStatusValue } from "../domain/page";
import { Template, type TemplateStatusValue } from "../domain/template";
import { RoutePath } from "../domain/value-objects/route-path";

/** Reads `{ ar?, en? }` from a stored JSON value: strings only, anything else is dropped. */
function readLocalized(value: unknown): LocalizedText {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const { ar, en } = value as Record<string, unknown>;
  return {
    ...(typeof ar === "string" && ar.length > 0 ? { ar } : {}),
    ...(typeof en === "string" && en.length > 0 ? { en } : {}),
  };
}

export interface PageRow {
  readonly id: string;
  readonly name: string;
  readonly routePath: string;
  readonly templateRef: string | null;
  readonly experienceRef: string | null;
  readonly seoProfileRef: string | null;
  readonly localeRef: string | null;
  readonly status: string;
  readonly title: unknown;
  readonly body: unknown;
  readonly metaDescription: unknown;
  readonly publishedAt: Date | null;
  readonly updatedAt: Date | null;
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
      {
        content: {
          title: readLocalized(row.title),
          body: readLocalized(row.body),
          metaDescription: readLocalized(row.metaDescription),
        },
        publishedAt: row.publishedAt ?? null,
        updatedAt: row.updatedAt ?? null,
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
      title: { ...page.title },
      body: { ...page.body },
      metaDescription: { ...page.metaDescription },
      publishedAt: page.publishedAt,
      // `undefined` lets the database stamp a page that was never touched by the domain.
      updatedAt: page.updatedAt ?? undefined,
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
