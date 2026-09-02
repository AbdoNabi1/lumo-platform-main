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

/**
 * Object storage abstraction. Uploads are performed by clients directly against storage via
 * signed URLs — the application issues URLs and verifies existence but does not proxy bytes.
 */
export interface StorageService {
  readonly bucket: string;
  getSignedUploadUrl(key: string, options?: SignedUrlOptions): Promise<string>;
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
