import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Locale, TranslationSet } from "@platform/localization";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});
const localeIdParams = z.object({ localeId: z.string().min(1) });

export interface LocaleDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly fallbackLocaleRef: string | null;
  readonly status: string;
}

function toLocaleDto(locale: Locale): LocaleDto {
  return {
    id: locale.id.toString(),
    code: locale.code.value,
    name: locale.name,
    isDefault: locale.isDefault,
    fallbackLocaleRef: locale.fallbackLocaleRef ?? null,
    status: locale.status,
  };
}

export interface TranslationDto {
  readonly key: string;
  readonly value: string;
  readonly status: string;
}

export interface TranslationSetDto {
  readonly id: string;
  readonly localeRef: string;
  readonly namespace: string;
  readonly translations: readonly TranslationDto[];
}

function toTranslationSetDto(set: TranslationSet): TranslationSetDto {
  return {
    id: set.id.toString(),
    localeRef: set.localeRef,
    namespace: set.namespace,
    translations: set.translations.map((t) => ({
      key: t.key,
      value: t.value,
      status: t.status.value,
    })),
  };
}

const createLocaleBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  isDefault: z.boolean(),
  fallbackLocaleRef: z.string().min(1).optional(),
});
const createTranslationSetBody = z.object({
  localeRef: z.string().min(1),
  namespace: z.string().min(1),
});
const translationSetIdParams = z.object({ translationSetId: z.string().min(1) });
const setTranslationBody = z.object({ key: z.string().min(1), value: z.string().min(1) });
const translationKeyBody = z.object({ key: z.string().min(1) });

/** The Localization admin HTTP surface (Sprint 5.4). Pure delegation. */
export function localizationRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/locales",
      version: 1,
      permission: "localization:create_locale",
      idempotent: true,
      summary: "Register a locale",
      schema: { body: createLocaleBody },
      handle: ({ body, context }) => admin.localization.createLocale(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/translation-sets",
      version: 1,
      permission: "localization:create_set",
      idempotent: true,
      summary: "Create a translation set",
      schema: { body: createTranslationSetBody },
      handle: ({ body, context }) =>
        admin.localization.createTranslationSet(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/translation-sets/:translationSetId/translations",
      version: 1,
      permission: "localization:set_translation",
      idempotent: true,
      summary: "Upsert a translation value",
      schema: { params: translationSetIdParams, body: setTranslationBody },
      handle: ({ params, body, context }) =>
        admin.localization.setTranslation(context.principal, {
          translationSetId: params.translationSetId,
          ...body,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/translation-sets/:translationSetId/translations/publish",
      version: 1,
      permission: "localization:publish_translation",
      idempotent: true,
      summary: "Publish a draft translation",
      schema: { params: translationSetIdParams, body: translationKeyBody },
      handle: ({ params, body, context }) =>
        admin.localization.publishTranslation(context.principal, {
          translationSetId: params.translationSetId,
          ...body,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/locales",
      version: 1,
      permission: "localization:read",
      summary: "List locales (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.localization.listLocales(context.principal, query), toLocaleDto),
    }),
    defineRoute({
      method: "GET",
      path: "/locales/:localeId",
      version: 1,
      permission: "localization:read",
      summary: "Get one locale by id",
      schema: { params: localeIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.localization.getLocale(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toLocaleDto(response.body as Locale) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/translation-sets",
      version: 1,
      permission: "localization:read",
      summary: "List translation sets (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.localization.listTranslationSets(context.principal, query),
          toTranslationSetDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/translation-sets/:translationSetId",
      version: 1,
      permission: "localization:read",
      summary: "Get one translation set by id",
      schema: { params: translationSetIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.localization.getTranslationSet(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toTranslationSetDto(response.body as TranslationSet) };
      },
    }),
  ] as readonly RouteDefinition[];
}
