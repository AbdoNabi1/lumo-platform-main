import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { StorageKeyFactory } from "@platform/storage";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import type { MediaAssetRepository } from "../domain/library-repositories";
import { MAX_ALT_LENGTH, MediaAsset } from "../domain/media-asset";
import type { ObjectStoragePort } from "./object-storage.port";
import { sniffImage, type ImageType } from "./sniff-image";

/** The largest upload accepted, in bytes. The route enforces the same cap before the body is read. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Keys are unique and never overwritten, so the object can be cached for a year and never revalidated. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const MAX_NAME_LENGTH = 255;

const CONTENT_TYPE: Readonly<Record<ImageType, string>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};
const EXTENSION: Readonly<Record<ImageType, string>> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
};

/** `${baseUrl}/${storageKey}` — the public bucket serves the key as-is. */
export function publicMediaUrl(baseUrl: string, storageKey: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${storageKey}`;
}

export interface UploadProductImageDeps {
  readonly mediaAssets: MediaAssetRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly objectStorage: ObjectStoragePort;
  readonly keyFactory: StorageKeyFactory;
  /** Where the public bucket is served from. Absent ⇒ uploads are unavailable (503). */
  readonly publicBaseUrl?: string;
}

export interface UploadProductImageInput {
  readonly bytes: Uint8Array;
  /** The client's file name — kept as the asset's display name only, never as part of the key. */
  readonly fileName?: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface UploadedImage {
  readonly id: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string | null;
}

export type UploadProductImageOutcome =
  | { readonly kind: "ok"; readonly image: UploadedImage }
  | { readonly kind: "unavailable" }
  | { readonly kind: "too_large" }
  | { readonly kind: "unsupported" };

/**
 * Stores a product image. The bytes decide everything: the type and size come from the header
 * (`sniffImage`), the key's extension from the type, the content type from the type; nothing the client
 * claims is trusted. Only JPEG, PNG, WebP and GIF pass; SVG and anything else is refused.
 */
export class UploadProductImage {
  private readonly deps: UploadProductImageDeps;

  constructor(deps: UploadProductImageDeps) {
    this.deps = deps;
  }

  async execute(input: UploadProductImageInput): Promise<UploadProductImageOutcome> {
    const { publicBaseUrl, objectStorage } = this.deps;
    if (!objectStorage.persistent || publicBaseUrl === undefined) return { kind: "unavailable" };
    if (input.bytes.length > MAX_UPLOAD_BYTES) return { kind: "too_large" };
    const sniffed = sniffImage(input.bytes);
    if (sniffed === null) return { kind: "unsupported" };

    const extension = EXTENSION[sniffed.type];
    const contentType = CONTENT_TYPE[sniffed.type];
    const storageKey = this.deps.keyFactory.build({
      tenantId: input.tenantId,
      namespace: "product-images",
      filename: `image.${extension}`,
    });
    const name = (input.fileName?.trim() ?? "").slice(0, MAX_NAME_LENGTH) || `image.${extension}`;

    await objectStorage.put(storageKey, input.bytes, contentType, IMMUTABLE_CACHE_CONTROL);

    const id = await this.deps.unitOfWork.run<string>(async (tx) => {
      const assetId = UniqueEntityId.from(this.deps.idGenerator.generate());
      const asset = MediaAsset.create(
        assetId,
        name,
        storageKey,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
        undefined,
        {
          contentType,
          byteSize: input.bytes.length,
          width: sniffed.width,
          height: sniffed.height,
        },
      );
      await this.deps.mediaAssets.save(asset, input.tenantId, tx);
      return assetId.toString();
    });

    return {
      kind: "ok",
      image: {
        id,
        url: publicMediaUrl(publicBaseUrl, storageKey),
        width: sniffed.width,
        height: sniffed.height,
        alt: null,
      },
    };
  }
}

export interface UpdateMediaAltInput {
  readonly mediaAssetId: string;
  /** `null` or blank clears the alt text. */
  readonly alt: string | null;
  readonly tenantId: string;
}

export interface UpdateMediaAltOutput {
  readonly mediaAssetId: string;
  readonly alt: string | null;
}

export type UpdateMediaAltDeps = Pick<UploadProductImageDeps, "mediaAssets" | "unitOfWork">;

/** Sets or clears an asset's alt text (Shopify keeps alt per media). At most 512 characters. */
export class UpdateMediaAlt {
  private readonly deps: UpdateMediaAltDeps;

  constructor(deps: UpdateMediaAltDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateMediaAltInput): Promise<Result<UpdateMediaAltOutput, DomainError>> {
    const alt = input.alt?.trim() ?? "";
    if (alt.length > MAX_ALT_LENGTH) {
      return err(
        new ValidationError("Invalid alt text", [
          { field: "alt", message: `must be at most ${MAX_ALT_LENGTH} characters` },
        ]),
      );
    }
    return this.deps.unitOfWork.run<Result<UpdateMediaAltOutput, DomainError>>(async (tx) => {
      const asset = await this.deps.mediaAssets.findById(input.mediaAssetId, input.tenantId, tx);
      if (asset === null) return err(new NotFoundError("Media asset not found"));
      asset.updateAlt(alt === "" ? undefined : alt);
      await this.deps.mediaAssets.save(asset, input.tenantId, tx);
      return ok({ mediaAssetId: asset.id.toString(), alt: alt === "" ? null : alt });
    });
  }
}
