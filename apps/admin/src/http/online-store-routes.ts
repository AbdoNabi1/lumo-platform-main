import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import { MAX_UPLOAD_BYTES, ONLINE_STORE_IMAGE_PURPOSES } from "@platform/media";
import type { WiredAdmin } from "../composition";
import { decodeFileName } from "./media-library-routes";

/** Shape only; lengths and normalisation are the domain's (spec 1.4). The cap stops abuse early. */
const localized = z
  .object({ ar: z.string().max(4000).optional(), en: z.string().max(4000).optional() })
  .strict();
const expectedVersion = z.number().int().min(0);

const preferencesBody = z
  .object({
    homeTitle: localized,
    homeMetaDescription: localized,
    shareImageId: z.string().min(1).max(64).nullable(),
    defaultLocale: z.enum(["ar", "en"]),
    expectedVersion,
  })
  .strict();
const accessBody = z
  .object({
    locked: z.boolean(),
    password: z.string().max(200).nullable().optional(),
    message: localized,
    expectedVersion,
  })
  .strict();
/** The document is validated by `@platform/storefront-content` (strict, unknown keys rejected). */
const draftBody = z.object({ document: z.unknown(), expectedVersion }).strict();
const versionBody = z.object({ expectedVersion }).strict();
const publishBody = z.object({ expectedDraftRevision: z.number().int().min(0) }).strict();
const releaseParams = z.object({ releaseNumber: z.coerce.number().int().positive() });
const imageQuery = z.object({ purpose: z.enum(ONLINE_STORE_IMAGE_PURPOSES) }).strict();
const emptyBody = z.object({}).strict();

/** What a browser may send as an online-store image. The bytes are still sniffed per purpose. */
const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Online Store admin surface (spec 1.9). Pure delegation; every write idempotent except preview tokens. */
export function onlineStoreRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/online-store/preferences",
      version: 1,
      permission: "online_store:read",
      summary:
        "Online Store preferences: home title, meta description, share image, default language",
      schema: {},
      handle: ({ context }) =>
        admin.onlineStore.getPreferences(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "PUT",
      path: "/online-store/preferences",
      version: 1,
      permission: "online_store:update_preferences",
      idempotent: true,
      summary: "Save the preferences (live on save)",
      schema: { body: preferencesBody },
      handle: ({ body, context }) =>
        admin.onlineStore.updatePreferences(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/online-store/access",
      version: 1,
      permission: "online_store:read",
      summary:
        "The password lock: locked, whether a password is set, the visitor message (never the hash)",
      schema: {},
      handle: ({ context }) =>
        admin.onlineStore.getAccess(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "PUT",
      path: "/online-store/access",
      version: 1,
      permission: "online_store_admin:update_access",
      idempotent: true,
      summary:
        "Lock or unlock the storefront, replace the password, edit the visitor message (admin)",
      schema: { body: accessBody },
      handle: ({ body, context }) =>
        admin.onlineStore.updateAccess(context.principal, {
          locked: body.locked,
          ...(body.password === undefined ? {} : { password: body.password }),
          message: body.message,
          expectedVersion: body.expectedVersion,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/online-store/theme",
      version: 1,
      permission: "online_store:read",
      summary: "The theme: draft, published, revisions, release number and resolved images",
      schema: {},
      handle: ({ context }) =>
        admin.onlineStore.getTheme(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "PUT",
      path: "/online-store/theme/draft",
      version: 1,
      permission: "online_store:edit_theme",
      idempotent: true,
      summary: "Save the theme draft (validated, contrast-checked, image ownership checked)",
      schema: { body: draftBody },
      handle: ({ body, context }) =>
        admin.onlineStore.saveThemeDraft(context.principal, {
          document: body.document,
          expectedVersion: body.expectedVersion,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/online-store/theme/discard-draft",
      version: 1,
      permission: "online_store:edit_theme",
      idempotent: true,
      summary: "Discard the draft: it becomes the live document again",
      schema: { body: versionBody },
      handle: ({ body, context }) =>
        admin.onlineStore.discardThemeDraft(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/online-store/theme/publish",
      version: 1,
      permission: "online_store_admin:publish_theme",
      idempotent: true,
      summary: "Publish the previewed draft revision (admin)",
      schema: { body: publishBody },
      handle: ({ body, context }) =>
        admin.onlineStore.publishTheme(context.principal, {
          expectedDraftRevision: body.expectedDraftRevision,
          by: context.principal.id,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/online-store/theme/releases",
      version: 1,
      permission: "online_store:read",
      summary: "The last 20 releases, newest first",
      schema: {},
      handle: ({ context }) =>
        admin.onlineStore.listThemeReleases(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/online-store/theme/releases/:releaseNumber/restore",
      version: 1,
      permission: "online_store_admin:publish_theme",
      idempotent: true,
      summary: "Copy a release into the draft (never straight to live) (admin)",
      schema: { params: releaseParams, body: versionBody },
      handle: ({ params, body, context }) =>
        admin.onlineStore.restoreThemeRelease(context.principal, {
          releaseNumber: params.releaseNumber,
          expectedVersion: body.expectedVersion,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/online-store/images",
      version: 1,
      permission: "online_store:upload_image",
      idempotent: true,
      summary:
        "Upload a logo, favicon, share image or section image (raw body; checked per purpose)",
      binaryBody: { maxBytes: MAX_UPLOAD_BYTES, contentTypes: IMAGE_CONTENT_TYPES },
      schema: { querystring: imageQuery },
      handle: ({ query, context }) => {
        const fileName = decodeFileName(context.headers?.["x-file-name"]);
        return admin.mediaLibrary.uploadImage(context.principal, {
          bytes: context.rawBody ?? new Uint8Array(),
          purpose: query.purpose,
          ...(fileName === undefined ? {} : { fileName }),
          tenantId: context.tenantId,
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/online-store/preview-tokens",
      version: 1,
      permission: "online_store:read",
      // NOT idempotent (binding lesson): a token must never be replayed from the response cache.
      summary: "Mint a 60-minute preview token for the draft; only its hash is stored",
      schema: { body: emptyBody },
      handle: ({ context }) =>
        admin.onlineStore.issuePreviewToken(context.principal, {
          createdBy: context.principal.id,
          tenantId: context.tenantId,
        }),
    }),
  ] as readonly RouteDefinition[];
}
