import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_BYTES, prepareImage } from "./prepare-image";

/** A fake decoded picture and a fake canvas: jsdom has neither, and the logic under test is the plan around them. */
interface Drawn {
  width: number;
  height: number;
}
let drawn: Drawn[];
let encodes: { type: string | undefined; quality: number | undefined }[];
let encoded: { bytes: number; type: string | null }; // what the fake canvas hands back; type null = browser can't encode that type

function file(name: string, type: string, bytes = 10): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function stubBrowser(size: { width: number; height: number }) {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: size.width, height: size.height, close: () => undefined })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      drawImage: () => {
        drawn.push({ width: this.width, height: this.height });
      },
    } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    callback: BlobCallback,
    type?: string,
    quality?: number,
  ) {
    encodes.push({ type, quality });
    // A browser that cannot encode `type` silently returns a PNG instead.
    const actual =
      encoded.type === null && type === "image/webp" ? "image/png" : (type ?? "image/png");
    callback(new Blob([new Uint8Array(encoded.bytes)], { type: actual }));
  });
}

beforeEach(() => {
  drawn = [];
  encodes = [];
  encoded = { bytes: 1000, type: "image/webp" };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("prepareImage (runs in the browser before an upload)", () => {
  it("re-encodes a photo as webp at quality 0.85, keeping a small picture's size", async () => {
    stubBrowser({ width: 800, height: 600 });
    const result = await prepareImage(file("shoe.jpg", "image/jpeg"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(drawn).toEqual([{ width: 800, height: 600 }]);
    expect(encodes).toEqual([{ type: "image/webp", quality: 0.85 }]);
    expect(result.file.type).toBe("image/webp");
    expect(result.file.name).toBe("shoe.webp");
  });

  it("scales the longest side down to 2048, keeping the proportions", async () => {
    stubBrowser({ width: 4000, height: 3000 });
    await prepareImage(file("big.png", "image/png"));
    expect(drawn).toEqual([{ width: 2048, height: 1536 }]);

    drawn = [];
    stubBrowser({ width: 1500, height: 3000 });
    await prepareImage(file("tall.png", "image/png"));
    expect(drawn).toEqual([{ width: 1024, height: 2048 }]);
  });

  it("never enlarges a picture that is already small", async () => {
    stubBrowser({ width: 100, height: 50 });
    await prepareImage(file("tiny.png", "image/png"));
    expect(drawn).toEqual([{ width: 100, height: 50 }]);
  });

  it("passes a gif through untouched so it keeps its animation", async () => {
    stubBrowser({ width: 10, height: 10 });
    const original = file("spin.gif", "image/gif", 500);
    const result = await prepareImage(original);

    expect(result.ok && result.file).toBe(original);
    expect(drawn).toEqual([]);
    expect(encodes).toEqual([]);
  });

  it("falls back to jpeg at 0.85 when the browser cannot encode webp", async () => {
    stubBrowser({ width: 100, height: 100 });
    encoded = { bytes: 1000, type: null };
    const result = await prepareImage(file("shoe.png", "image/png"));

    expect(encodes).toEqual([
      { type: "image/webp", quality: 0.85 },
      { type: "image/jpeg", quality: 0.85 },
    ]);
    expect(result.ok && result.file.type).toBe("image/jpeg");
    expect(result.ok && result.file.name).toBe("shoe.jpg");
  });

  it("refuses a file that is still over 8 MB after preparation", async () => {
    stubBrowser({ width: 100, height: 100 });
    encoded = { bytes: MAX_UPLOAD_BYTES + 1, type: "image/webp" };
    expect(await prepareImage(file("huge.png", "image/png"))).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("refuses a gif over 8 MB without trying to re-encode it", async () => {
    stubBrowser({ width: 10, height: 10 });
    const big = file("big.gif", "image/gif", 1);
    Object.defineProperty(big, "size", { value: MAX_UPLOAD_BYTES + 1 });
    expect(await prepareImage(big)).toEqual({ ok: false, reason: "too_large" });
  });

  it.each([
    ["an svg", file("logo.svg", "image/svg+xml")],
    ["a pdf", file("doc.pdf", "application/pdf")],
    ["a file with no type", file("mystery", "")],
  ])("refuses %s as unsupported", async (_label, input) => {
    stubBrowser({ width: 10, height: 10 });
    expect(await prepareImage(input)).toEqual({ ok: false, reason: "unsupported" });
    expect(encodes).toEqual([]);
  });

  it("refuses a file the browser cannot decode as unsupported", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("decode failed");
      }),
    );
    expect(await prepareImage(file("broken.jpg", "image/jpeg"))).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});
