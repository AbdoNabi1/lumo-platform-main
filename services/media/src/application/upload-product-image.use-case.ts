import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import { MAX_ALT_LENGTH } from "../domain/media-asset";
import { UploadImage, type UploadedImage, type UploadImageDeps } from "./upload-image.use-case";

// The shared upload exports live in upload-image.use-case.ts (no runtime import cycle between the two
// modules); they are re-exported here under their existing names so every caller is unchanged.
export {
  IMMUTABLE_CACHE_CONTROL,
  MAX_UPLOAD_BYTES,
  publicMediaUrl,
  type StorageKeyBuilder,
  type UploadedImage,
} from "./upload-image.use-case";

export type UploadProductImageDeps = UploadImageDeps;

export interface UploadProductImageInput {
  readonly bytes: Uint8Array;
  /** The client's file name — kept as the asset's display name only, never as part of the key. */
  readonly fileName?: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export type UploadProductImageOutcome =
  | { readonly kind: "ok"; readonly image: UploadedImage }
  | { readonly kind: "unavailable" }
  | { readonly kind: "too_large" }
  | { readonly kind: "unsupported" };

/**
 * Stores a product image. Delegates to `UploadImage` with the `product` purpose, whose policy is the
 * Plan 2C-3 behaviour exactly (anti-goal: no change to `POST /media/uploads`): JPEG, PNG, WebP and GIF,
 * 8 MB, no dimension or pixel rule. SVG and anything else is refused.
 */
export class UploadProductImage {
  private readonly upload: UploadImage;

  constructor(deps: UploadProductImageDeps) {
    this.upload = new UploadImage(deps);
  }

  async execute(input: UploadProductImageInput): Promise<UploadProductImageOutcome> {
    const outcome = await this.upload.execute({ ...input, purpose: "product" });
    switch (outcome.kind) {
      case "ok":
      case "unavailable":
      case "unsupported":
        return outcome;
      case "too_large":
        return { kind: "too_large" };
      case "bad_dimensions":
      case "too_many_pixels":
        // The product policy has no dimension or pixel rule, so these cannot happen.
        return { kind: "unsupported" };
    }
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
