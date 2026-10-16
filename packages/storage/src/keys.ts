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
const LEAF_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const YEAR_PATTERN = /^\d{4}$/;
const MONTH_PATTERN = /^(0[1-9]|1[0-2])$/;

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

/** The parts of a key {@link StorageKeyFactory} produced. */
export interface ParsedStorageKey {
  readonly tenantId: string;
  readonly namespace: StorageNamespace;
}

/**
 * The exact inverse of {@link StorageKeyFactory.build} — the one place the key grammar is read, kept
 * next to the one place it is written so the two cannot drift. Returns `null` for anything the factory
 * would not have produced: a different shape, an unknown namespace, an out-of-range month, a `..` or
 * empty or percent-encoded or backslash segment, a leading/trailing slash. It is deliberately a strict
 * parse of the factory's own grammar, not a `startsWith("tenants/<id>/")` — a prefix test would accept
 * `tenants/a/../b/x`, which a CDN or signing layer that normalises paths resolves into tenant b.
 */
export function parseStorageKey(key: string): ParsedStorageKey | null {
  const parts = key.split("/");
  if (parts.length !== 6 || parts[0] !== "tenants") return null;
  const [, tenantId, namespace, yyyy, mm, leaf] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (!TENANT_PATTERN.test(tenantId)) return null;
  if (!Object.prototype.hasOwnProperty.call(NAMESPACE_BUCKETS, namespace)) return null;
  if (!YEAR_PATTERN.test(yyyy) || !MONTH_PATTERN.test(mm)) return null;
  const dot = leaf.indexOf(".");
  const id = dot === -1 ? leaf : leaf.slice(0, dot);
  const ext = dot === -1 ? undefined : leaf.slice(dot + 1);
  if (!LEAF_ID_PATTERN.test(id)) return null;
  if (ext !== undefined && !EXTENSION_PATTERN.test(ext)) return null;
  return { tenantId, namespace: namespace as StorageNamespace };
}

/**
 * True only when `key` is a well-formed factory key whose tenant segment IS `tenantId`. Anything
 * malformed, or under another tenant, is false. This is the storage-side ownership test (G-68/F-22):
 * an application accepting or signing a key on behalf of a tenant must pass it first.
 */
export function storageKeyBelongsToTenant(key: string, tenantId: string): boolean {
  if (!TENANT_PATTERN.test(tenantId)) return false;
  return parseStorageKey(key)?.tenantId === tenantId;
}
