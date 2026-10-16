import type { MediaAssetRepository } from "../domain/library-repositories";
import type { MediaAsset } from "../domain/media-asset";
import { publicMediaUrl } from "./upload-product-image.use-case";

/**
 * What a reader (admin or storefront) may know about an image: where it is, how to describe it and how
 * big it is. Never the storage key and never a tenant id. `width`/`height` are `null` for assets
 * registered before sizes were recorded.
 */
export interface ResolvedImage {
  readonly id: string;
  readonly url: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface ResolveMediaImagesDeps {
  readonly mediaAssets: MediaAssetRepository;
  /** Absent ⇒ no url can be made, so no image resolves. */
  readonly publicBaseUrl?: string;
}

export interface ResolveMediaImagesInput {
  readonly ids: readonly string[];
  /** ADR-0014: the caller's verified tenant. A foreign id is simply absent. */
  readonly tenantId: string;
}

const usable = (asset: MediaAsset): boolean => asset.status.value === "active";

/**
 * Plan 2C-3: turns media ids into images with ONE tenant-scoped read, whatever the number of ids —
 * the reason a product list of fifty rows costs one query for its pictures, not fifty. A missing,
 * archived or foreign id is skipped (never an error); callers keep their own order by looking ids up
 * in the returned map.
 */
export class ResolveMediaImages {
  private readonly deps: ResolveMediaImagesDeps;

  constructor(deps: ResolveMediaImagesDeps) {
    this.deps = deps;
  }

  async execute(input: ResolveMediaImagesInput): Promise<ReadonlyMap<string, ResolvedImage>> {
    const images = new Map<string, ResolvedImage>();
    const { publicBaseUrl } = this.deps;
    if (publicBaseUrl === undefined || input.ids.length === 0) return images;

    const assets = await this.deps.mediaAssets.findByIds(input.ids, input.tenantId);
    for (const asset of assets) {
      if (!usable(asset)) continue;
      const id = asset.id.toString();
      images.set(id, {
        id,
        url: publicMediaUrl(publicBaseUrl, asset.storageKey),
        alt: asset.alt ?? null,
        width: asset.width ?? null,
        height: asset.height ?? null,
      });
    }
    return images;
  }

  /** The subset of `ids` that are this tenant's own active assets (one read). */
  async existingIds(ids: readonly string[], tenantId: string): Promise<readonly string[]> {
    if (ids.length === 0) return [];
    const assets = await this.deps.mediaAssets.findByIds(ids, tenantId);
    const owned = new Set(assets.filter(usable).map((asset) => asset.id.toString()));
    return ids.filter((id) => owned.has(id));
  }
}
