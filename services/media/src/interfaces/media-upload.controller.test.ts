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
