/**
 * Runtime-agnostic byte stream (contracts carry no Node types — framework independence).
 * Node's `Readable` and WHATWG `ReadableStream` (via `values()`) both satisfy it.
 */
export type ByteStream = AsyncIterable<Uint8Array>;

/**
 * Logical storage namespaces — every stored object belongs to exactly one (doc 26 §5, D-045).
 * Namespaces map to buckets + key prefixes in the adapter; new object kinds add a namespace
 * here, never an ad-hoc key format.
 */
export type StorageNamespace =
  | "product-images"
  | "collection-images"
  | "brand-assets"
  | "theme-assets"
  | "customer-uploads"
  | "documents"
  | "exports"
  | "imports"
  | "generated"
  | "tmp"
  | "audit-exports"
  | "invoices"
  | "email-attachments"
  | "app-storage";

/** Descriptive metadata stored WITH the object (adapter maps to provider metadata/headers). */
export interface ObjectDescriptor {
  readonly tenantId: string;
  readonly namespace: StorageNamespace;
  /** Owning principal (customer/staff/app id) when applicable. */
  readonly ownerId?: string;
  /** Owning bounded context (e.g. `media`, `orders`). */
  readonly context?: string;
  /** Owning aggregate id (bare id — never an FK). */
  readonly aggregateId?: string;
  readonly contentType: string;
  /** Base64 SHA-256 of the content, verified by the provider when supplied. */
  readonly checksumSha256?: string;
  readonly createdBy?: string;
  /** Small string→string bag (future tags). */
  readonly tags?: Readonly<Record<string, string>>;
}

/** What `head` returns: the descriptor plus provider-observed facts. */
export interface ObjectMetadata extends ObjectDescriptor {
  readonly key: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

/**
 * Outbound port for object storage (D-018/D-045). Keys are **immutable and tenant-prefixed**
 * (`tenants/<tenantId>/…`, built ONLY by the key factory — never by hand): `put` MUST refuse to
 * overwrite an existing key (conditional write), so a key's content never changes once written —
 * CDN-cacheable forever, version-safe by construction (a new version is a new key). Soft delete
 * and retention ride bucket versioning + lifecycle policies (configuration, doc 26 §5);
 * `delete` here is the permanent operation and must be treated as such.
 */
export interface ObjectStorage {
  /** Writes a NEW object; rejects if the key exists (immutability). */
  put(key: string, body: Uint8Array | ByteStream, descriptor: ObjectDescriptor): Promise<void>;
  /** Streams an object's content; `null` when absent. */
  getStream(key: string): Promise<ByteStream | null>;
  head(key: string): Promise<ObjectMetadata | null>;
  exists(key: string): Promise<boolean>;
  /** PERMANENT delete (soft delete = bucket versioning; see port doc). */
  delete(key: string): Promise<void>;
}

/** Outbound port for time-limited access without proxying bytes (browser up/downloads). */
export interface SignedUrlProvider {
  signedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  /** Upload URL is bound to the content type; the object is still subject to key immutability. */
  signedUploadUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string>;
}

export interface MultipartPart {
  readonly partNumber: number;
  readonly etag: string;
}

/**
 * Outbound port for large-file uploads. Resume = `listParts` on a known `uploadId`, then
 * continue from the next part number; abandonments MUST be aborted (or lifecycle-expired) or
 * they accrue storage cost invisibly.
 */
export interface MultipartUpload {
  create(key: string, descriptor: ObjectDescriptor): Promise<{ readonly uploadId: string }>;
  uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Uint8Array | ByteStream,
  ): Promise<MultipartPart>;
  listParts(key: string, uploadId: string): Promise<readonly MultipartPart[]>;
  complete(key: string, uploadId: string, parts: readonly MultipartPart[]): Promise<void>;
  abort(key: string, uploadId: string): Promise<void>;
}
