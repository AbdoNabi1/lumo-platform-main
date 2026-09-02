import type { Clock, IdGenerator, StorageNamespace } from "@platform/contracts";

/**
 * Namespace → bucket mapping (doc 26 §5, D-045). Buckets are purpose-scoped; tenants are key
 * prefixes — never buckets (bucket-per-tenant does not scale to Shopify-style tenant counts).
 * `media` is the CDN-fronted bucket (immutable keys ⇒ cache-forever); `exports`/`imports` carry
 * 30-day lifecycle expiry; `backups` is versioned with long retention.
 */
export type BucketPurpose = "media" | "exports" | "imports" | "backups";

const NAMESPACE_BUCKETS: Readonly<Record<StorageNamespace, BucketPurpose>> = {
  "product-images": "media",
  "collection-images": "media",
  "brand-assets": "media",
  "theme-assets": "media",
  "customer-uploads": "media",
  documents: "media",
  invoices: "media",
  "email-attachments": "media",
  "app-storage": "media",
  generated: "exports",
  exports: "exports",
  "audit-exports": "exports",
  imports: "imports",
  tmp: "imports",
};

export function resolveBucket(namespace: StorageNamespace): BucketPurpose {
  return NAMESPACE_BUCKETS[namespace];
}

export interface BuildKeyInput {
  readonly tenantId: string;
  readonly namespace: StorageNamespace;
  /** Untrusted original filename — only a sanitized extension survives into the key. */
  readonly filename?: string;
}

const EXTENSION_PATTERN = /^[a-z0-9]{1,10}$/;
const TENANT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface StorageKeyFactoryDeps {
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * The ONLY sanctioned producer of object keys (port contract, D-045):
 *
 *   `tenants/<tenantId>/<namespace>/<yyyy>/<mm>/<uuid>[.<ext>]`
 *
 * Properties: **tenant-prefixed** (isolation + per-tenant lifecycle/export/erasure by prefix,
 * ADR-0008); **immutable + collision-free** (UUIDv7 leaf ⇒ a key is written once, cacheable
 * forever; a new version is a new key); **CDN-friendly** (no query-string identity, stable
 * prefixes); **time-bucketed** (`yyyy/mm` keeps listings/lifecycle tractable at scale);
 * **untrusted-input-proof** (the client filename contributes at most a sanitized extension —
 * never path segments; a hostile `../../etc/passwd` contributes nothing).
 */
export class StorageKeyFactory {
  private readonly deps: StorageKeyFactoryDeps;

  constructor(deps: StorageKeyFactoryDeps) {
    this.deps = deps;
  }

  build(input: BuildKeyInput): string {
    if (!TENANT_PATTERN.test(input.tenantId)) {
      throw new Error(`StorageKeyFactory: invalid tenant id "${input.tenantId}"`);
    }
    const now = this.deps.clock.now();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const id = this.deps.idGenerator.generate();
    const ext = extractExtension(input.filename);
    return `tenants/${input.tenantId}/${input.namespace}/${yyyy}/${mm}/${id}${ext}`;
  }
}

function extractExtension(filename: string | undefined): string {
  if (filename === undefined) return "";
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  const candidate = filename.slice(dot + 1).toLowerCase();
  return EXTENSION_PATTERN.test(candidate) ? `.${candidate}` : "";
}
