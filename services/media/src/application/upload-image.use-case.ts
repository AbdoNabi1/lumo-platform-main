import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type { MediaAssetRepository } from "../domain/library-repositories";
import { MediaAsset } from "../domain/media-asset";
import {
  IMAGE_POLICIES,
  MAX_UPLOAD_BYTES,
  type ImageNamespace,
  type ImagePurpose,
} from "./image-purposes";
import type { ObjectStoragePort } from "./object-storage.port";
import { sniffImage, type ImageType } from "./sniff-image";

// These shared exports live here (and are re-exported by upload-product-image.use-case.ts) so the two
// modules do not import each other's values: `no-circular` forbids a runtime cycle.

export { MAX_UPLOAD_BYTES };
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

/** Mints the object key. `@platform/storage`'s `StorageKeyFactory` is the production implementation. */
export interface StorageKeyBuilder {
  build(input: {
    readonly tenantId: string;
    readonly namespace: ImageNamespace;
    readonly filename?: string;
  }): string;
}

export interface UploadImageDeps {
  readonly mediaAssets: MediaAssetRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly objectStorage: ObjectStoragePort;
  readonly keyFactory: StorageKeyBuilder;
  /** Where the public bucket is served from. Absent ⇒ uploads are unavailable (503). */
  readonly publicBaseUrl?: string;
}

export interface UploadedImage {
  readonly id: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string | null;
}

export interface UploadImageInput {
  readonly bytes: Uint8Array;
  /** Display name only, never part of the key. */
  readonly fileName?: string;
  readonly purpose: ImagePurpose;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export type UploadImageOutcome =
  | { readonly kind: "ok"; readonly image: UploadedImage }
  | { readonly kind: "unavailable" }
  | { readonly kind: "too_large"; readonly maxBytes: number }
  | { readonly kind: "unsupported" }
  | {
      readonly kind: "bad_dimensions";
      readonly min: { readonly width: number; readonly height: number };
      readonly max: number | null;
      readonly square: boolean;
    }
  | { readonly kind: "too_many_pixels" };

/**
 * Stores an image for one purpose (spec 1.7). Order: storage available → byte cap → sniff → type
 * allowed for the purpose → pixel cap → dimensions → store. Nothing is written unless all pass.
 */
export class UploadImage {
  private readonly deps: UploadImageDeps;

  constructor(deps: UploadImageDeps) {
    this.deps = deps;
  }

  async execute(input: UploadImageInput): Promise<UploadImageOutcome> {
    const { publicBaseUrl, objectStorage } = this.deps;
    if (!objectStorage.persistent || publicBaseUrl === undefined) return { kind: "unavailable" };
    const policy = IMAGE_POLICIES[input.purpose];
    if (input.bytes.length > policy.maxBytes) {
      return { kind: "too_large", maxBytes: policy.maxBytes };
    }
    const sniffed = sniffImage(input.bytes);
    if (sniffed === null || !policy.types.includes(sniffed.type)) return { kind: "unsupported" };
    if (policy.maxPixels !== null && sniffed.width * sniffed.height > policy.maxPixels) {
      return { kind: "too_many_pixels" };
    }
    const d = policy.dimensions;
    if (d !== null) {
      const tooSmall = sniffed.width < d.minWidth || sniffed.height < d.minHeight;
      const tooBig =
        d.maxSide !== null && (sniffed.width > d.maxSide || sniffed.height > d.maxSide);
      const notSquare = d.square && sniffed.width !== sniffed.height;
      if (tooSmall || tooBig || notSquare) {
        return {
          kind: "bad_dimensions",
          min: { width: d.minWidth, height: d.minHeight },
          max: d.maxSide,
          square: d.square,
        };
      }
    }

    const extension = EXTENSION[sniffed.type];
    const contentType = CONTENT_TYPE[sniffed.type];
    const storageKey = this.deps.keyFactory.build({
      tenantId: input.tenantId,
      namespace: policy.namespace,
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
