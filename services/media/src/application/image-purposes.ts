import type { ImageType } from "./sniff-image";

export type ImagePurpose = "product" | "logo" | "favicon" | "share_image" | "section_image";
export const ONLINE_STORE_IMAGE_PURPOSES = [
  "logo",
  "favicon",
  "share_image",
  "section_image",
] as const;
export type OnlineStoreImagePurpose = (typeof ONLINE_STORE_IMAGE_PURPOSES)[number];
export type ImageNamespace = "product-images" | "brand-assets" | "theme-assets";

/** Decompression-bomb guard for the online-store purposes (Ruling 3: products unchanged). */
export const MAX_IMAGE_PIXELS = 40_000_000;
const MB = 1024 * 1024;
/** The largest product upload accepted, in bytes. The route enforces the same cap before the body is read. */
export const MAX_UPLOAD_BYTES = 8 * MB;

export interface ImagePolicy {
  readonly namespace: ImageNamespace;
  readonly types: readonly ImageType[];
  readonly maxBytes: number;
  readonly dimensions: {
    readonly minWidth: number;
    readonly minHeight: number;
    readonly maxSide: number | null;
    readonly square: boolean;
  } | null;
  readonly maxPixels: number | null;
}

/** Spec 1.7, checked AFTER sniffing: the bytes decide, never the client's content type. */
export const IMAGE_POLICIES: Readonly<Record<ImagePurpose, ImagePolicy>> = {
  product: {
    namespace: "product-images",
    types: ["jpeg", "png", "webp", "gif"],
    maxBytes: MAX_UPLOAD_BYTES,
    dimensions: null,
    maxPixels: null,
  },
  logo: {
    namespace: "brand-assets",
    types: ["png", "webp", "jpeg"],
    maxBytes: 2 * MB,
    dimensions: { minWidth: 32, minHeight: 32, maxSide: 4000, square: false },
    maxPixels: MAX_IMAGE_PIXELS,
  },
  favicon: {
    namespace: "brand-assets",
    types: ["png"],
    maxBytes: 1 * MB,
    dimensions: { minWidth: 32, minHeight: 32, maxSide: 1024, square: true },
    maxPixels: MAX_IMAGE_PIXELS,
  },
  share_image: {
    namespace: "brand-assets",
    types: ["jpeg", "png"],
    maxBytes: 5 * MB,
    dimensions: { minWidth: 600, minHeight: 315, maxSide: null, square: false },
    maxPixels: MAX_IMAGE_PIXELS,
  },
  section_image: {
    namespace: "theme-assets",
    types: ["jpeg", "png", "webp"],
    maxBytes: 8 * MB,
    dimensions: { minWidth: 200, minHeight: 200, maxSide: null, square: false },
    maxPixels: MAX_IMAGE_PIXELS,
  },
};
