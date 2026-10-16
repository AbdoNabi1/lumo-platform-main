import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { S3StorageService } from "./storage";

function fakeClient() {
  const sent: unknown[] = [];
  const client = {
    send: async (command: unknown) => {
      sent.push(command);
      return {};
    },
  } as unknown as S3Client;
  return { client, sent };
}

describe("S3StorageService.putObject", () => {
  it("writes the bytes with the content type and the cache header, to its own bucket", async () => {
    const { client, sent } = fakeClient();
    const bytes = Uint8Array.from([1, 2, 3]);

    await new S3StorageService(client, "media").putObject("tenants/t/product-images/a.png", bytes, {
      contentType: "image/png",
      cacheControl: "public, max-age=31536000, immutable",
    });

    expect(sent).toHaveLength(1);
    const command = sent[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "media",
      Key: "tenants/t/product-images/a.png",
      Body: bytes,
      ContentType: "image/png",
      CacheControl: "public, max-age=31536000, immutable",
    });
  });

  it("does not send a conditional-write header, which S3-compatible providers may not support", async () => {
    const { client, sent } = fakeClient();
    await new S3StorageService(client, "media").putObject("k.png", new Uint8Array(), {
      contentType: "image/png",
    });
    const input = (sent[0] as PutObjectCommand).input;
    expect(input.IfNoneMatch).toBeUndefined();
    expect(input.CacheControl).toBeUndefined();
  });
});
