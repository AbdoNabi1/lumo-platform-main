import { afterAll, describe, expect, it } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { S3ObjectStorage } from "./s3-object-storage";

/**
 * REFERENCE integration suite for the Sprint-2.4 storage adapter. Requires live S3-compatible
 * storage (MinIO via the compose stack):
 *
 *   STORAGE_TEST_BUCKET=media S3_ENDPOINT=http://localhost:9000 \
 *   AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin \
 *   pnpm --filter @platform/storage test
 *
 * HONESTLY GATED: skipped without the env — never faked (Docker engine not running on this
 * machine; first-boot runbook applies).
 */
const bucket = process.env["STORAGE_TEST_BUCKET"];
const endpoint = process.env["S3_ENDPOINT"];
const accessKeyId = process.env["AWS_ACCESS_KEY_ID"];
const secretAccessKey = process.env["AWS_SECRET_ACCESS_KEY"];
const enabled = Boolean(bucket && endpoint && accessKeyId && secretAccessKey);

describe.runIf(enabled)("S3ObjectStorage (integration)", () => {
  const client = new S3Client({
    endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: accessKeyId ?? "", secretAccessKey: secretAccessKey ?? "" },
  });
  const storage = new S3ObjectStorage(client, bucket ?? "");
  const key = `tenants/t-itest/documents/2026/07/${crypto.randomUUID()}.txt`;
  const descriptor = {
    tenantId: "t-itest",
    namespace: "documents",
    contentType: "text/plain",
    context: "media",
    createdBy: "itest",
  } as const;

  afterAll(async () => {
    await storage.delete(key).catch(() => undefined);
    client.destroy();
  });

  it("puts a new object, reads metadata + stream back, and REFUSES overwrite (immutability)", async () => {
    await storage.put(key, new TextEncoder().encode("hello"), descriptor);

    const head = await storage.head(key);
    expect(head?.tenantId).toBe("t-itest");
    expect(head?.namespace).toBe("documents");
    expect(head?.sizeBytes).toBe(5);

    const stream = await storage.getStream(key);
    let bytes = 0;
    for await (const chunk of stream ?? []) bytes += chunk.length;
    expect(bytes).toBe(5);

    await expect(
      storage.put(key, new TextEncoder().encode("overwrite!"), descriptor),
    ).rejects.toThrow(); // If-None-Match: * — a key's content never changes
  });

  it("issues signed download/upload URLs with bounded expiry", async () => {
    const download = await storage.signedDownloadUrl(key, 60);
    const upload = await storage.signedUploadUrl(`${key}.next`, "text/plain", 60);
    expect(download).toContain("X-Amz-Expires=60");
    expect(upload).toContain("X-Amz-Expires=60");
  });

  it("multipart: create → listParts (resume seam) → abort leaves no object", async () => {
    const mpKey = `tenants/t-itest/imports/2026/07/${crypto.randomUUID()}.bin`;
    const { uploadId } = await storage.create(mpKey, { ...descriptor, namespace: "imports" });
    expect(uploadId.length).toBeGreaterThan(0);
    expect(await storage.listParts(mpKey, uploadId)).toHaveLength(0);
    await storage.abort(mpKey, uploadId);
    expect(await storage.exists(mpKey)).toBe(false);
  });
});
