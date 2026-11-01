import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { StorageKeyFactory } from "@platform/storage";
import { InMemoryMediaAssetRepository } from "../infrastructure/in-memory-library-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { MediaLibraryEventTranslator } from "../infrastructure/media-library-event-translator";
import { IMAGE_POLICIES } from "./image-purposes";
import type { ObjectStoragePort } from "./object-storage.port";
import { UploadImage, type UploadImageInput } from "./upload-image.use-case";
import { MAX_UPLOAD_BYTES } from "./upload-product-image.use-case";

const clock: Clock = { now: () => new Date("2026-10-27T09:30:00.000Z") };
const MB = 1024 * 1024;

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16be = (n: number) => [(n >>> 8) & 255, n & 255];
const u16le = (n: number) => [n & 255, (n >>> 8) & 255];
const u24le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Headers only: the sniffer reads sizes from the header; `pad` makes the body as large as needed. */
function bytes(head: number[], pad = 0): Uint8Array {
  const out = new Uint8Array(head.length + pad);
  out.set(head);
  return out;
}
const png = (w: number, h: number, pad = 0) =>
  bytes(
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
      ...ascii("IHDR"),
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
const jpeg = (w: number, h: number, pad = 0) =>
  bytes([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, ...u16be(h), ...u16be(w), 3, 0, 0, 0, 0], pad);
const webp = (w: number, h: number) =>
  bytes([
    ...ascii("RIFF"),
    0,
    0,
    0,
    0,
    ...ascii("WEBP"),
    ...ascii("VP8X"),
    10,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...u24le(w - 1),
    ...u24le(h - 1),
  ]);
const gif = (w: number, h: number) =>
  bytes([...ascii("GIF89a"), ...u16le(w), ...u16le(h), 0, 0, 0]);

/** `publicBaseUrl`: omitted ⇒ the default URL; `null` ⇒ none configured (uploads unavailable). */
function harness(options: { readonly publicBaseUrl?: string | null } = {}) {
  const publicBaseUrl =
    options.publicBaseUrl === undefined ? "https://cdn.test/media" : options.publicBaseUrl;
  const puts: { key: string; contentType: string }[] = [];
  const storage: ObjectStoragePort = {
    persistent: true,
    exists: async () => true,
    getDownloadUrl: async (k) => k,
    put: async (key, _b, contentType) => {
      puts.push({ key, contentType });
    },
  };
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `0192f0aa-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new MediaLibraryEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "media",
  });
  const upload = new UploadImage({
    mediaAssets: new InMemoryMediaAssetRepository({
      outbox,
      context: rootEventContext(idGenerator),
    }),
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator,
    clock,
    objectStorage: storage,
    keyFactory: new StorageKeyFactory({ idGenerator, clock }),
    ...(publicBaseUrl === null ? {} : { publicBaseUrl }),
  });
  const run = (input: Omit<UploadImageInput, "tenantId">) =>
    upload.execute({ ...input, tenantId: "t-1" });
  return { run, puts };
}

describe("UploadImage — per-purpose policy (spec 1.7, Review Focus 5)", () => {
  it("stores a logo under brand-assets with the sniffed type", async () => {
    const { run, puts } = harness();
    const out = await run({ bytes: png(400, 120), purpose: "logo", fileName: "logo.png" });
    expect(out).toMatchObject({ kind: "ok", image: { width: 400, height: 120, alt: null } });
    expect(puts).toEqual([
      {
        key: expect.stringMatching(/^tenants\/t-1\/brand-assets\/2026\/10\/.+\.png$/),
        contentType: "image/png",
      },
    ]);
  });

  it("stores a section image under theme-assets", async () => {
    const { run, puts } = harness();
    expect((await run({ bytes: webp(1600, 900), purpose: "section_image" })).kind).toBe("ok");
    expect(puts[0]?.key).toMatch(/\/theme-assets\//);
  });

  it.each([
    ["logo GIF", gif(200, 200), "logo", { kind: "unsupported" }],
    ["logo over 2 MB", png(200, 200, 2 * MB), "logo", { kind: "too_large", maxBytes: 2 * MB }],
    [
      "logo 20 px tall",
      png(400, 20),
      "logo",
      { kind: "bad_dimensions", min: { width: 32, height: 32 }, max: 4000, square: false },
    ],
    [
      "logo 5000 px wide",
      png(5000, 100),
      "logo",
      { kind: "bad_dimensions", min: { width: 32, height: 32 }, max: 4000, square: false },
    ],
    ["favicon that is a JPEG named .png", jpeg(64, 64), "favicon", { kind: "unsupported" }],
    ["animated GIF favicon", gif(64, 64), "favicon", { kind: "unsupported" }],
    [
      "favicon not square",
      png(64, 32),
      "favicon",
      { kind: "bad_dimensions", min: { width: 32, height: 32 }, max: 1024, square: true },
    ],
    ["favicon over 1 MB", png(64, 64, MB), "favicon", { kind: "too_large", maxBytes: MB }],
    ["WebP share image", webp(1200, 630), "share_image", { kind: "unsupported" }],
    [
      "share image 599 wide",
      jpeg(599, 315),
      "share_image",
      { kind: "bad_dimensions", min: { width: 600, height: 315 }, max: null, square: false },
    ],
    [
      "section image 150 px",
      png(150, 600),
      "section_image",
      { kind: "bad_dimensions", min: { width: 200, height: 200 }, max: null, square: false },
    ],
    [
      "pixel bomb: 20000 × 20000 header in a 7.9 MB body",
      png(20000, 20000, Math.floor(7.9 * MB)),
      "section_image",
      { kind: "too_many_pixels" },
    ],
    [
      "an SVG",
      bytes(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>")),
      "logo",
      { kind: "unsupported" },
    ],
  ] as const)("refuses %s and stores nothing", async (_name, input, purpose, expected) => {
    const { run, puts } = harness();
    expect(await run({ bytes: input, purpose })).toEqual(expected);
    expect(puts).toEqual([]);
  });

  it("accepts the share-image minimum and a square PNG favicon", async () => {
    const { run } = harness();
    expect((await run({ bytes: jpeg(600, 315), purpose: "share_image" })).kind).toBe("ok");
    expect((await run({ bytes: png(512, 512), purpose: "favicon" })).kind).toBe("ok");
  });

  it("keeps products exactly as before: GIF allowed, no dimension or pixel rule (Ruling 3)", async () => {
    const { run } = harness();
    expect((await run({ bytes: gif(10, 10), purpose: "product" })).kind).toBe("ok");
    expect((await run({ bytes: png(20000, 20000), purpose: "product" })).kind).toBe("ok");
    expect(await run({ bytes: png(10, 10, 8 * MB), purpose: "product" })).toEqual({
      kind: "too_large",
      maxBytes: 8 * MB,
    });
  });

  it("restates the product cap as exactly MAX_UPLOAD_BYTES", () => {
    expect(IMAGE_POLICIES.product.maxBytes).toBe(MAX_UPLOAD_BYTES);
  });

  it("is unavailable without a public base url", async () => {
    const { run } = harness({ publicBaseUrl: null });
    expect(await run({ bytes: png(100, 100), purpose: "logo" })).toEqual({ kind: "unavailable" });
  });
});
