import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { StorageKeyFactory, storageKeyBelongsToTenant } from "@platform/storage";
import { InMemoryMediaAssetRepository } from "../infrastructure/in-memory-library-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { MediaLibraryEventTranslator } from "../infrastructure/media-library-event-translator";
import type { ObjectStoragePort } from "./object-storage.port";
import { UpdateMediaAlt, UploadProductImage } from "./upload-product-image.use-case";

const clock: Clock = { now: () => new Date("2026-10-14T09:30:00.000Z") };
const BASE_URL = "https://cdn.example.test/media";
const IMMUTABLE = "public, max-age=31536000, immutable";
const EIGHT_MB = 8 * 1024 * 1024;

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
/** A 3×2 PNG header — enough for the sniffer; the rest of the file is irrelevant to it. */
function png(extraBytes = 0): Uint8Array {
  const head = [
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
    ...ascii("IHDR"),
    0,
    0,
    0,
    3,
    0,
    0,
    0,
    2,
    8,
    6,
    0,
    0,
    0,
  ];
  const bytes = new Uint8Array(head.length + extraBytes);
  bytes.set(head);
  return bytes;
}

interface Put {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly cacheControl: string;
}

function harness(overrides: { persistent?: boolean; publicBaseUrl?: string | undefined } = {}) {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new MediaLibraryEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "media",
  });
  const mediaAssets = new InMemoryMediaAssetRepository({
    outbox,
    context: rootEventContext(idGenerator),
  });
  const puts: Put[] = [];
  const objectStorage: ObjectStoragePort = {
    persistent: overrides.persistent ?? true,
    exists: async () => true,
    getDownloadUrl: async (key) => `https://signed.example/${key}`,
    put: async (key, bytes, contentType, cacheControl) => {
      puts.push({ key, bytes, contentType, cacheControl });
    },
  };
  const deps = {
    mediaAssets,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator,
    clock,
    objectStorage,
    keyFactory: new StorageKeyFactory({ idGenerator, clock }),
    ...("publicBaseUrl" in overrides
      ? overrides.publicBaseUrl === undefined
        ? {}
        : { publicBaseUrl: overrides.publicBaseUrl }
      : { publicBaseUrl: BASE_URL }),
  };
  return { deps, puts, mediaAssets, upload: new UploadProductImage(deps) };
}

describe("UploadProductImage", () => {
  it("stores the bytes under a tenant-prefixed product-images key with the immutable cache header", async () => {
    const h = harness();
    const bytes = png();
    const outcome = await h.upload.execute({ bytes, fileName: "front.PNG", tenantId: "tenant-a" });

    expect(outcome.kind).toBe("ok");
    expect(h.puts).toHaveLength(1);
    const put = h.puts[0]!;
    expect(storageKeyBelongsToTenant(put.key, "tenant-a")).toBe(true);
    expect(put.key).toMatch(/^tenants\/tenant-a\/product-images\/2026\/10\/[^/]+\.png$/);
    expect(put.contentType).toBe("image/png");
    expect(put.cacheControl).toBe(IMMUTABLE);
    expect(put.bytes).toEqual(bytes);
  });

  it("takes the type and extension from the bytes, never from the file name", async () => {
    const h = harness();
    await h.upload.execute({ bytes: png(), fileName: "shell.php.svg", tenantId: "tenant-a" });
    expect(h.puts[0]!.key.endsWith(".png")).toBe(true);
    expect(h.puts[0]!.contentType).toBe("image/png");
  });

  it("registers an active asset with the type, size, dimensions and name, and returns the public url", async () => {
    const h = harness();
    const bytes = png(100);
    const outcome = await h.upload.execute({ bytes, fileName: "front.png", tenantId: "tenant-a" });
    if (outcome.kind !== "ok") throw new Error(`expected ok, got ${outcome.kind}`);

    expect(outcome.image).toMatchObject({ width: 3, height: 2, alt: null });
    expect(outcome.image.url).toBe(`${BASE_URL}/${h.puts[0]!.key}`);

    const asset = await h.mediaAssets.findById(outcome.image.id, "tenant-a");
    expect(asset).not.toBeNull();
    expect(asset!.status.value).toBe("active");
    expect(asset!.storageKey).toBe(h.puts[0]!.key);
    expect(asset!.name).toBe("front.png");
    expect(asset!.contentType).toBe("image/png");
    expect(asset!.byteSize).toBe(bytes.length);
    expect(asset!.width).toBe(3);
    expect(asset!.height).toBe(2);
    // the other tenant can neither see nor read it
    expect(await h.mediaAssets.findById(outcome.image.id, "tenant-b")).toBeNull();
  });

  it("trims a very long file name to 255 characters and falls back to a name when none is given", async () => {
    const h = harness();
    const long = await h.upload.execute({
      bytes: png(),
      fileName: `${"a".repeat(400)}.png`,
      tenantId: "tenant-a",
    });
    const unnamed = await h.upload.execute({ bytes: png(), tenantId: "tenant-a" });
    if (long.kind !== "ok" || unnamed.kind !== "ok") throw new Error("expected ok");
    expect((await h.mediaAssets.findById(long.image.id, "tenant-a"))!.name).toHaveLength(255);
    expect((await h.mediaAssets.findById(unnamed.image.id, "tenant-a"))!.name).toBe("image.png");
  });

  it.each([
    ["an svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')],
    ["html", new TextEncoder().encode("<html><body>hi</body></html>")],
    ["an empty body", new Uint8Array()],
  ])("refuses %s and never writes to storage", async (_label, bytes) => {
    const h = harness();
    const outcome = await h.upload.execute({ bytes, fileName: "x.png", tenantId: "tenant-a" });
    expect(outcome.kind).toBe("unsupported");
    expect(h.puts).toHaveLength(0);
  });

  it("refuses a body over 8 MB even when its header is a valid image", async () => {
    const h = harness();
    const outcome = await h.upload.execute({
      bytes: png(EIGHT_MB),
      fileName: "big.png",
      tenantId: "tenant-a",
    });
    expect(outcome.kind).toBe("too_large");
    expect(h.puts).toHaveLength(0);
  });

  it("accepts a body of exactly 8 MB", async () => {
    const h = harness();
    const head = png();
    const bytes = new Uint8Array(EIGHT_MB);
    bytes.set(head);
    const outcome = await h.upload.execute({ bytes, fileName: "edge.png", tenantId: "tenant-a" });
    expect(outcome.kind).toBe("ok");
  });

  it("is unavailable when the storage does not really store, and writes nothing", async () => {
    const h = harness({ persistent: false });
    const outcome = await h.upload.execute({ bytes: png(), tenantId: "tenant-a" });
    expect(outcome.kind).toBe("unavailable");
    expect(h.puts).toHaveLength(0);
  });

  it("is unavailable when no public base url is configured, and writes nothing", async () => {
    const h = harness({ publicBaseUrl: undefined });
    const outcome = await h.upload.execute({ bytes: png(), tenantId: "tenant-a" });
    expect(outcome.kind).toBe("unavailable");
    expect(h.puts).toHaveLength(0);
  });
});

describe("UpdateMediaAlt", () => {
  async function uploaded() {
    const h = harness();
    const outcome = await h.upload.execute({
      bytes: png(),
      fileName: "a.png",
      tenantId: "tenant-a",
    });
    if (outcome.kind !== "ok") throw new Error("expected ok");
    return { h, id: outcome.image.id, update: new UpdateMediaAlt(h.deps) };
  }

  it("sets the alt text, trimmed", async () => {
    const { h, id, update } = await uploaded();
    const result = await update.execute({
      mediaAssetId: id,
      alt: "  Red shoe  ",
      tenantId: "tenant-a",
    });
    expect(result.ok && result.value).toEqual({ mediaAssetId: id, alt: "Red shoe" });
    expect((await h.mediaAssets.findById(id, "tenant-a"))!.alt).toBe("Red shoe");
  });

  it("clears the alt text when it is empty or null", async () => {
    const { h, id, update } = await uploaded();
    await update.execute({ mediaAssetId: id, alt: "Red shoe", tenantId: "tenant-a" });
    const cleared = await update.execute({ mediaAssetId: id, alt: "   ", tenantId: "tenant-a" });
    expect(cleared.ok && cleared.value.alt).toBeNull();
    expect((await h.mediaAssets.findById(id, "tenant-a"))!.alt).toBeUndefined();
  });

  it("accepts 512 characters and refuses 513", async () => {
    const { id, update } = await uploaded();
    expect(
      (await update.execute({ mediaAssetId: id, alt: "a".repeat(512), tenantId: "tenant-a" })).ok,
    ).toBe(true);
    const tooLong = await update.execute({
      mediaAssetId: id,
      alt: "a".repeat(513),
      tenantId: "tenant-a",
    });
    expect(!tooLong.ok && tooLong.error.code).toBe("VALIDATION");
  });

  it("is a not-found for another tenant's asset, and leaves it untouched", async () => {
    const { h, id, update } = await uploaded();
    const result = await update.execute({ mediaAssetId: id, alt: "stolen", tenantId: "tenant-b" });
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
    expect((await h.mediaAssets.findById(id, "tenant-a"))!.alt).toBeUndefined();
  });
});
