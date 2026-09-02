import { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  ByteStream,
  MultipartPart,
  MultipartUpload,
  ObjectDescriptor,
  ObjectMetadata,
  ObjectStorage,
  SignedUrlProvider,
  StorageNamespace,
} from "@platform/contracts";

/** Descriptor fields ride as S3 user metadata (lowercase keys per S3 semantics). */
function toUserMetadata(descriptor: ObjectDescriptor): Record<string, string> {
  return {
    "tenant-id": descriptor.tenantId,
    namespace: descriptor.namespace,
    ...(descriptor.ownerId !== undefined ? { "owner-id": descriptor.ownerId } : {}),
    ...(descriptor.context !== undefined ? { context: descriptor.context } : {}),
    ...(descriptor.aggregateId !== undefined ? { "aggregate-id": descriptor.aggregateId } : {}),
    ...(descriptor.createdBy !== undefined ? { "created-by": descriptor.createdBy } : {}),
    ...(descriptor.tags !== undefined
      ? Object.fromEntries(Object.entries(descriptor.tags).map(([k, v]) => [`tag-${k}`, v]))
      : {}),
  };
}

function toBody(body: Uint8Array | ByteStream): Uint8Array | Readable {
  return body instanceof Uint8Array ? body : Readable.from(body);
}

/**
 * S3-compatible adapter (MinIO locally, S3/R2 in production — no vendor lock-in) implementing
 * the `ObjectStorage` + `SignedUrlProvider` + `MultipartUpload` ports for a single bucket.
 *
 * Immutability: `put` sends `If-None-Match: *` — the provider atomically rejects overwrites
 * (S3 conditional writes; MinIO ≥ 2024-08). Providers without conditional-write support are NOT
 * acceptable adapters for the `media` bucket (port contract). Checksums: a supplied
 * `checksumSha256` is verified server-side by the provider. Encryption at rest and bucket
 * policies are provider configuration (doc 26 §5 / doc 14 §2), not code.
 */
export class S3ObjectStorage implements ObjectStorage, SignedUrlProvider, MultipartUpload {
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(client: S3Client, bucket: string) {
    this.client = client;
    this.bucket = bucket;
  }

  async put(
    key: string,
    body: Uint8Array | ByteStream,
    descriptor: ObjectDescriptor,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: toBody(body),
        ContentType: descriptor.contentType,
        IfNoneMatch: "*",
        ...(descriptor.checksumSha256 !== undefined
          ? { ChecksumSHA256: descriptor.checksumSha256 }
          : {}),
        Metadata: toUserMetadata(descriptor),
      }),
    );
  }

  async getStream(key: string): Promise<ByteStream | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = result.Body;
      if (body === undefined) return null;
      // In the Node runtime the SDK body is a Readable, which is AsyncIterable<Uint8Array> —
      // exactly the ByteStream contract (localized sound cast at the SDK type-erasure boundary).
      return body as ByteStream;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const meta = result.Metadata ?? {};
      const tags = Object.fromEntries(
        Object.entries(meta)
          .filter(([k]) => k.startsWith("tag-"))
          .map(([k, v]) => [k.slice(4), v]),
      );
      return {
        key,
        tenantId: meta["tenant-id"] ?? "",
        namespace: (meta["namespace"] ?? "documents") as StorageNamespace,
        ownerId: meta["owner-id"],
        context: meta["context"],
        aggregateId: meta["aggregate-id"],
        createdBy: meta["created-by"],
        contentType: result.ContentType ?? "application/octet-stream",
        checksumSha256: result.ChecksumSHA256,
        sizeBytes: result.ContentLength ?? 0,
        createdAt: (result.LastModified ?? new Date(0)).toISOString(),
        ...(Object.keys(tags).length > 0 ? { tags } : {}),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  signedDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  signedUploadUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
  }

  async create(key: string, descriptor: ObjectDescriptor): Promise<{ readonly uploadId: string }> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: descriptor.contentType,
        Metadata: toUserMetadata(descriptor),
      }),
    );
    if (result.UploadId === undefined) {
      throw new Error("S3ObjectStorage: provider returned no uploadId");
    }
    return { uploadId: result.UploadId };
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Uint8Array | ByteStream,
  ): Promise<MultipartPart> {
    const result = await this.client.send(
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: toBody(body),
      }),
    );
    if (result.ETag === undefined) {
      throw new Error("S3ObjectStorage: provider returned no ETag for part");
    }
    return { partNumber, etag: result.ETag };
  }

  async listParts(key: string, uploadId: string): Promise<readonly MultipartPart[]> {
    const result = await this.client.send(
      new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
    );
    return (result.Parts ?? []).map((part) => ({
      partNumber: part.PartNumber ?? 0,
      etag: part.ETag ?? "",
    }));
  }

  async complete(key: string, uploadId: string, parts: readonly MultipartPart[]): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async abort(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
    );
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string }).name;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === "NotFound" || name === "NoSuchKey" || status === 404;
}
