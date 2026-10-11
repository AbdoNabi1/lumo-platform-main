import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface SignedUrlOptions {
  readonly expiresInSeconds?: number;
  readonly contentType?: string;
}

export interface PutObjectOptions {
  readonly contentType: string;
  /** e.g. `public, max-age=31536000, immutable` — sent as the object's `Cache-Control`. */
  readonly cacheControl?: string;
}

/**
 * Object storage abstraction. Large uploads are performed by clients directly against storage via
 * signed URLs; `putObject` is the server-side write for small objects the server has already
 * validated (product images, Plan 2C-3).
 */
export interface StorageService {
  readonly bucket: string;
  getSignedUploadUrl(key: string, options?: SignedUrlOptions): Promise<string>;
  putObject(key: string, body: Uint8Array, options: PutObjectOptions): Promise<void>;
  getSignedDownloadUrl(key: string, options?: SignedUrlOptions): Promise<string>;
  objectExists(key: string): Promise<boolean>;
  ensureBucket(): Promise<void>;
}

const DEFAULT_EXPIRY_SECONDS = 900;

/** S3-backed implementation of the storage abstraction, scoped to a single bucket. */
export class S3StorageService implements StorageService {
  readonly bucket: string;
  private readonly client: S3Client;

  constructor(client: S3Client, bucket: string) {
    this.client = client;
    this.bucket = bucket;
  }

  getSignedUploadUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS,
    });
  }

  async putObject(key: string, body: Uint8Array, options: PutObjectOptions): Promise<void> {
    // No `IfNoneMatch`: keys carry a fresh id and are never rewritten, and not every S3-compatible
    // provider supports conditional writes.
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        ...(options.cacheControl !== undefined ? { CacheControl: options.cacheControl } : {}),
      }),
    );
  }

  getSignedDownloadUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS,
    });
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async ensureBucket(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = error.name;
    return name === "NotFound" || name === "NoSuchKey";
  }
  return false;
}
