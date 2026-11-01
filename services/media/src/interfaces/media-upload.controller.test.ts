import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryObjectStorage } from "../infrastructure/object-storage-adapters";
import type { ObjectStoragePort } from "../application/object-storage.port";
import { wireMediaLibrary } from "../media-library.composition";

const clock: Clock = { now: () => new Date("2026-10-14T00:00:00.000Z") };
const ids = (): IdGenerator => {
  let n = 0;
  return { generate: () => `id-${(n += 1)}` };
};
const BASE = "https://cdn.example.test/media";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3,
  0, 0, 0, 2, 8, 6, 0, 0, 0,
]);

function realStorage(): ObjectStoragePort & { readonly keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    persistent: true,
    exists: async () => true,
    getDownloadUrl: async (key) => `https://signed.example/${key}`,
    put: async (key) => {
      keys.push(key);
    },
  };
}

function wire(objectStorage: ObjectStoragePort, publicBaseUrl: string | null = BASE) {
  return wireMediaLibrary({
    serializer: new InMemoryEventSerializer(),
    idGenerator: ids(),
    clock,
    objectStorage,
    ...(publicBaseUrl === null ? {} : { publicMediaBaseUrl: publicBaseUrl }),
  }).mediaLibrary;
}

describe("MediaLibraryController — uploads and alt text (Plan 2C-3)", () => {
  it("201 with the public url, size and no storage key", async () => {
    const storage = realStorage();
    const response = await wire(storage).uploadProductImage({
      bytes: PNG,
      fileName: "front.png",
      tenantId: "tenant-a",
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ width: 3, height: 2, alt: null });
    const body = response.body as { id: string; url: string };
    expect(body.url).toBe(`${BASE}/${storage.keys[0]}`);
    expect(body).not.toHaveProperty("storageKey");
  });

  it("415 for an svg, and nothing is written", async () => {
    const storage = realStorage();
    const response = await wire(storage).uploadProductImage({
      bytes: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      tenantId: "tenant-a",
    });
    expect(response.status).toBe(415);
    expect(response.body).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
    expect(storage.keys).toHaveLength(0);
  });

  it("413 over 8 MB", async () => {
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(PNG);
    const response = await wire(realStorage()).uploadProductImage({ bytes: big, tenantId: "t" });
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("503 with a plain message when storage is the in-memory stub", async () => {
    const response = await wire(new InMemoryObjectStorage()).uploadProductImage({
      bytes: PNG,
      tenantId: "tenant-a",
    });
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: "UNAVAILABLE",
      message: "Image storage isn't set up yet.",
    });
  });

  it("503 when the public base url is missing", async () => {
    const response = await wire(realStorage(), null).uploadProductImage({
      bytes: PNG,
      tenantId: "tenant-a",
    });
    expect(response.status).toBe(503);
  });

  it("updates alt text, and answers 404 for another tenant's asset", async () => {
    const controller = wire(realStorage());
    const created = await controller.uploadProductImage({ bytes: PNG, tenantId: "tenant-a" });
    const { id } = created.body as { id: string };

    const ok = await controller.updateMediaAlt({
      mediaAssetId: id,
      alt: "Red shoe",
      tenantId: "tenant-a",
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ mediaAssetId: id, alt: "Red shoe" });

    const foreign = await controller.updateMediaAlt({
      mediaAssetId: id,
      alt: "stolen",
      tenantId: "tenant-b",
    });
    expect(foreign.status).toBe(404);
  });
});

const MB = 1024 * 1024;
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16be = (n: number) => [(n >>> 8) & 255, n & 255];

/** Headers only: the sniffer reads sizes from the header; `pad` grows the body. */
function sized(head: number[], pad: number): Uint8Array {
  const out = new Uint8Array(head.length + pad);
  out.set(head);
  return out;
}
const png = (w: number, h: number, pad = 0) =>
  sized(
    [
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0,
      0,
      0,
      13,
      0x49,
      0x48,
      0x44,
      0x52,
      ...u32be(w),
      ...u32be(h),
      8,
      6,
      0,
      0,
      0,
    ],
    pad,
  );
const jpeg = (w: number, h: number) =>
  sized([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, ...u16be(h), ...u16be(w), 3, 0, 0, 0, 0], 0);

describe("MediaLibraryController.uploadImage", () => {
  it("maps each outcome to its status and code", async () => {
    const controller = wire(realStorage());
    expect(
      (await controller.uploadImage({ bytes: jpeg(64, 64), purpose: "favicon", tenantId: "t-1" }))
        .status,
    ).toBe(415);
    const bad = await controller.uploadImage({
      bytes: png(400, 20),
      purpose: "logo",
      tenantId: "t-1",
    });
    expect(bad).toEqual({
      status: 422,
      body: {
        code: "BAD_DIMENSIONS",
        message: "The image size is not allowed here.",
        retryable: false,
        fields: [],
        min: { width: 32, height: 32 },
        max: 4000,
        square: false,
      },
    });
    expect(
      (
        await controller.uploadImage({
          bytes: png(20000, 20000),
          purpose: "section_image",
          tenantId: "t-1",
        })
      ).body,
    ).toMatchObject({ code: "IMAGE_TOO_LARGE_DIMENSIONS" });
    expect(
      await controller.uploadImage({
        bytes: png(64, 64, 3 * MB),
        purpose: "logo",
        tenantId: "t-1",
      }),
    ).toMatchObject({
      status: 413,
      body: { code: "PAYLOAD_TOO_LARGE", message: "The image is larger than 2 MB." },
    });
  });

  it("201 with the public url for a valid logo, 503 when storage is not set up", async () => {
    const storage = realStorage();
    const created = await wire(storage).uploadImage({
      bytes: png(400, 120),
      purpose: "logo",
      tenantId: "t-1",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ width: 400, height: 120, alt: null });
    expect((created.body as { url: string }).url).toBe(`${BASE}/${storage.keys[0]}`);

    const unavailable = await wire(new InMemoryObjectStorage()).uploadImage({
      bytes: png(400, 120),
      purpose: "logo",
      tenantId: "t-1",
    });
    expect(unavailable.status).toBe(503);
  });
});
