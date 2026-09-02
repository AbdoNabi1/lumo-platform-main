import { afterAll, describe, expect, it } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { S3StorageService } from "./storage";

/**
 * M2-2 REFERENCE integration suite for `S3StorageService` — the exact class
 * `StorageServiceObjectStorage` (services/media) wraps in production. Complements
 * `s3-object-storage.integration.test.ts` (which covers the sibling `S3ObjectStorage` class'
 * put/head/multipart surface); this file covers the surface Media actually consumes: bucket
 * existence, the signed-upload → real-PUT → objectExists → signed-download → real-GET round trip,
 * and object metadata (content-type) preservation. Requires live S3-compatible storage (MinIO via
 * the compose stack):
 *
 *   STORAGE_TEST_BUCKET=media S3_ENDPOINT=http://localhost:9000 \
 *   AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin \
 *   pnpm --filter @platform/storage test
 *
 * HONESTLY GATED: skipped without the env — never faked (same convention as
 * `s3-object-storage.integration.test.ts`; Docker engine unavailable in the sandbox this suite was
 * authored in, see M2_2_REPORT.md).
 */
const bucket = process.env["STORAGE_TEST_BUCKET"];
const endpoint = process.env["S3_ENDPOINT"];
const accessKeyId = process.env["AWS_ACCESS_KEY_ID"];
const secretAccessKey = process.env["AWS_SECRET_ACCESS_KEY"];
const enabled = Boolean(bucket && endpoint && accessKeyId && secretAccessKey);

describe.runIf(enabled)("S3StorageService (integration, M2-2)", () => {
  const client = new S3Client({
    endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: accessKeyId ?? "", secretAccessKey: secretAccessKey ?? "" },
  });
  const service = new S3StorageService(client, bucket ?? "");
  const key = `m2-2-itest/${crypto.randomUUID()}.txt`;
  const content = "M2-2 real MinIO round trip";

  afterAll(() => {
    client.destroy();
  });

  it("confirms the bucket exists (bucket provisioning, docker-compose createbuckets)", async () => {
    await expect(service.ensureBucket()).resolves.toBeUndefined();
  });

  it("objectExists() reports false before the object is written — a real HEAD check, not always-true", async () => {
    expect(await service.objectExists(key)).toBe(false);
  });

  it("uploads via the signed upload URL, then exists()/downloads confirm it landed with metadata preserved", async () => {
    const uploadUrl = await service.getSignedUploadUrl(key, { contentType: "text/plain" });
    const putResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: content,
    });
    expect(putResponse.ok).toBe(true);

    expect(await service.objectExists(key)).toBe(true);

    const downloadUrl = await service.getSignedDownloadUrl(key);
    const getResponse = await fetch(downloadUrl);
    expect(getResponse.ok).toBe(true);
    expect(await getResponse.text()).toBe(content);
    expect(getResponse.headers.get("content-type")).toContain("text/plain");
  });

  it("issues signed URLs with the requested bounded expiry", async () => {
    const download = await service.getSignedDownloadUrl(key, { expiresInSeconds: 60 });
    expect(download).toContain("X-Amz-Expires=60");
  });
});
