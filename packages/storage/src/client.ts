import { S3Client } from "@aws-sdk/client-s3";
import type { StorageConfig } from "@platform/config/server";

/**
 * Only the connection fields `createS3Client` actually reads — `StorageConfig.buckets` is
 * irrelevant to client construction (M2-2: lets a caller with no bucket registry, e.g.
 * `apps/runtime`, build a client without fabricating unused bucket names).
 */
type S3ClientConfig = Pick<
  StorageConfig,
  "endpoint" | "region" | "forcePathStyle" | "accessKeyId" | "secretAccessKey"
>;

/** Creates an S3-compatible client (MinIO in dev, S3/R2 in prod) from injected config. */
export function createS3Client(config: S3ClientConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}
