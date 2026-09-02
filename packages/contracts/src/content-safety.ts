import type { ObjectMetadata } from "./object-storage";

/**
 * Hook for content/virus scanning (D-045; interface only — adapters like ClamAV or a vendor API
 * arrive when the first user-upload surface ships). Contract: objects in user-upload namespaces
 * are quarantined (not served) until a `clean` verdict; `error` is NOT `clean` — fail closed for
 * serving, retry the scan.
 */
export type ScanVerdict = "clean" | "infected" | "error";

export interface FileScanResult {
  readonly verdict: ScanVerdict;
  /** Threat name / error detail for audit + operator triage. */
  readonly detail?: string;
}

export interface FileScanner {
  scan(metadata: ObjectMetadata): Promise<FileScanResult>;
}

/**
 * Seam for derived-image generation (resize/crop/WebP/AVIF/responsive variants) — future-ready
 * only per the sprint scope; NO processing is implemented. Contract fixed now so the storage
 * layer never needs redesign: a transformation NEVER mutates the source — it produces a **new
 * immutable key** derived deterministically from `(sourceKey, spec)`, cache-friendly forever.
 */
export interface ImageTransformSpec {
  readonly width?: number;
  readonly height?: number;
  readonly fit?: "cover" | "contain";
  readonly format?: "webp" | "avif" | "jpeg" | "png";
  readonly quality?: number;
}

export interface ImageTransformer {
  /** Returns the derived object's key (creating it if needed). Source is never modified. */
  transform(sourceKey: string, spec: ImageTransformSpec): Promise<string>;
}
