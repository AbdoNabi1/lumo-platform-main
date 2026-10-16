import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import { MAX_UPLOAD_BYTES, type Folder, type MediaAsset } from "@platform/media";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});

export interface FolderDto {
  readonly id: string;
  readonly name: string;
  readonly parentFolderRef: string | null;
  readonly status: string;
}

function toFolderDto(folder: Folder): FolderDto {
  return {
    id: folder.id.toString(),
    name: folder.name,
    parentFolderRef: folder.parentFolderRef ?? null,
    status: folder.status.value,
  };
}

export interface MediaAssetDto {
  readonly id: string;
  readonly name: string;
  readonly storageKey: string;
  readonly folderRef: string | null;
  readonly status: string;
}

function toMediaAssetDto(asset: MediaAsset): MediaAssetDto {
  return {
    id: asset.id.toString(),
    name: asset.name,
    storageKey: asset.storageKey,
    folderRef: asset.folderRef ?? null,
    status: asset.status.value,
  };
}

const createFolderBody = z.object({
  name: z.string().min(1),
  parentFolderRef: z.string().min(1).optional(),
});
const folderIdParams = z.object({ folderId: z.string().min(1) });
const registerMediaAssetBody = z.object({
  name: z.string().min(1),
  storageKey: z.string().min(1),
  folderRef: z.string().min(1).optional(),
});
const mediaAssetIdParams = z.object({ mediaAssetId: z.string().min(1) });
const updateAltBody = z.object({ alt: z.string().nullable() });

/** What a browser may send as an image. The bytes are still sniffed: this only narrows the doorway. */
const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

function decodeFileName(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

/** The Media Library admin HTTP surface (Sprint 5.4). Pure delegation. */
export function mediaLibraryRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/media/folders",
      version: 1,
      permission: "media_library:create_folder",
      idempotent: true,
      summary: "Create an organizational folder",
      schema: { body: createFolderBody },
      handle: ({ body, context }) =>
        admin.mediaLibrary.createFolder(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/media/folders/:folderId/archive",
      version: 1,
      permission: "media_library:archive_folder",
      idempotent: true,
      summary: "Archive a folder",
      schema: { params: folderIdParams },
      handle: ({ params, context }) =>
        admin.mediaLibrary.archiveFolder(context.principal, {
          ...params,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/media/assets",
      version: 1,
      permission: "media_library:register_asset",
      idempotent: true,
      summary: "Register a media asset (verifies object existence first)",
      schema: { body: registerMediaAssetBody },
      handle: ({ body, context }) =>
        admin.mediaLibrary.registerMediaAsset(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/media/uploads",
      version: 1,
      permission: "products:update",
      idempotent: true,
      summary: "Upload a product image (raw body; JPEG, PNG, WebP or GIF, at most 8 MB)",
      binaryBody: { maxBytes: MAX_UPLOAD_BYTES, contentTypes: IMAGE_CONTENT_TYPES },
      schema: {},
      handle: ({ context }) =>
        admin.mediaLibrary.uploadProductImage(context.principal, {
          bytes: context.rawBody ?? new Uint8Array(),
          ...optional("fileName", decodeFileName(context.headers?.["x-file-name"])),
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "PATCH",
      path: "/media/assets/:mediaAssetId",
      version: 1,
      permission: "products:update",
      idempotent: true,
      summary: "Set or clear a media asset's alt text",
      schema: { params: mediaAssetIdParams, body: updateAltBody },
      handle: ({ params, body, context }) =>
        admin.mediaLibrary.updateMediaAlt(context.principal, {
          ...params,
          alt: body.alt,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/media/assets/:mediaAssetId/archive",
      version: 1,
      permission: "media_library:archive_asset",
      idempotent: true,
      summary: "Archive a media asset",
      schema: { params: mediaAssetIdParams },
      handle: ({ params, context }) =>
        admin.mediaLibrary.archiveMediaAsset(context.principal, {
          ...params,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/media/assets/:mediaAssetId/download-url",
      version: 1,
      permission: "media_library:get_download_url",
      summary: "Issue a download URL for a media asset",
      schema: { params: mediaAssetIdParams },
      handle: ({ params, context }) =>
        admin.mediaLibrary.getDownloadUrl(context.principal, {
          ...params,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/media/folders",
      version: 1,
      permission: "media_library:read",
      summary: "List folders (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.mediaLibrary.listFolders(context.principal, {
            ...query,
            tenantId: context.tenantId,
          }),
          toFolderDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/media/folders/:folderId",
      version: 1,
      permission: "media_library:read",
      summary: "Get one folder by id",
      schema: { params: folderIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.mediaLibrary.getFolder(context.principal, {
          ...params,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) return response;
        return { status: 200, body: toFolderDto(response.body as Folder) };
      },
    }),
    defineRoute({
      method: "GET",
      path: "/media/assets",
      version: 1,
      permission: "media_library:read",
      summary: "List media assets (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(
          await admin.mediaLibrary.listMediaAssets(context.principal, {
            ...query,
            tenantId: context.tenantId,
          }),
          toMediaAssetDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/media/assets/:mediaAssetId",
      version: 1,
      permission: "media_library:read",
      summary: "Get one media asset by id",
      schema: { params: mediaAssetIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.mediaLibrary.getMediaAsset(context.principal, {
          ...params,
          tenantId: context.tenantId,
        });
        if (response.status !== 200) return response;
        return { status: 200, body: toMediaAssetDto(response.body as MediaAsset) };
      },
    }),
  ] as readonly RouteDefinition[];
}
