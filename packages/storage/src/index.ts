import type { S3Client } from "@aws-sdk/client-s3";
import type { StorageConfig } from "@platform/config/server";
import type { HealthCheck } from "@platform/health";
import { createS3Client } from "./client";
import { S3StorageService, type StorageService } from "./storage";
import { createStorageHealthCheck } from "./health";

export { createS3Client } from "./client";
export { S3StorageService, type StorageService, type SignedUrlOptions } from "./storage";
export { createStorageHealthCheck } from "./health";
export { S3ObjectStorage } from "./s3-object-storage";
export {
  StorageKeyFactory,
  resolveBucket,
  type BucketPurpose,
  type BuildKeyInput,
  type StorageKeyFactoryDeps,
} from "./keys";
export { validateUpload, type UploadCandidate, type UploadPolicy } from "./upload-policy";

export type BucketName = "media" | "exports" | "backups";

/** A managed storage handle: client, per-bucket services, and a health probe. */
export interface StorageHandle {
  readonly client: S3Client;
  bucket(name: BucketName): StorageService;
  healthCheck(): HealthCheck;
}

/** Composition root for the object-storage infrastructure (dependency-injected config). */
export function createStorage(config: StorageConfig): StorageHandle {
  const client = createS3Client(config);
  const services: Record<BucketName, StorageService> = {
    media: new S3StorageService(client, config.buckets.media),
    exports: new S3StorageService(client, config.buckets.exports),
    backups: new S3StorageService(client, config.buckets.backups),
  };
  const bucketNames: readonly string[] = [
    config.buckets.media,
    config.buckets.exports,
    config.buckets.backups,
  ];
  return {
    client,
    bucket: (name) => services[name],
    healthCheck: () => createStorageHealthCheck(client, bucketNames),
  };
}
