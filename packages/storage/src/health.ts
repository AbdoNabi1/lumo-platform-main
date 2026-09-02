import { HeadBucketCommand, type S3Client } from "@aws-sdk/client-s3";
import type { HealthCheck } from "@platform/health";

/** Storage health probe: confirms each configured bucket is reachable. */
export function createStorageHealthCheck(client: S3Client, buckets: readonly string[]): HealthCheck {
  return {
    name: "storage",
    async probe(): Promise<void> {
      for (const bucket of buckets) {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      }
    },
  };
}
