import { describe, expect, it } from "vitest";
import { sniffImage } from "./sniff-image";

/** Tiny hand-built headers: 3 wide and 2 high, so a swapped width/height cannot pass by accident. */
const u16be = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const u16le = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
const u24le = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u32be = (n: number): number[] => [...u16be(n >>> 16), ...u16be(n & 0xffff)];
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

function jpeg(sof: number, width: number, height: number, leading: number[] = []): Uint8Array {
  const jfif = [
    0xff,
    0xe0,
    ...u16be(16),
    ...ascii("JFIF"),
    0,
    1,
    1,
    0,
    ...u16be(1),
    ...u16be(1),
    0,
    0,
  ];
  const frame = [
    0xff,
    sof,
    ...u16be(17),
    8,
    ...u16be(height),
    ...u16be(width),
    3,
    1,
    0x11,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ];
  return Uint8Array.from([0xff, 0xd8, ...jfif, ...leading, ...frame, 0xff, 0xd9]);
}

function png(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32be(13),
    ...ascii("IHDR"),
    ...u32be(width),
    ...u32be(height),
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
}

function gif(width: number, height: number): Uint8Array {
  return Uint8Array.from([...ascii("GIF89a"), ...u16le(width), ...u16le(height), 0, 0, 0, 0x3b]);
}

function riff(chunk: number[]): Uint8Array {
  return Uint8Array.from([
    ...ascii("RIFF"),
    ...u32le(chunk.length + 4),
    ...ascii("WEBP"),
    ...chunk,
  ]);
}
const u32le = (n: number): number[] => [...u16le(n & 0xffff), ...u16le(n >>> 16)];

function webpLossy(width: number, height: number): Uint8Array {
  const data = [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, ...u16le(width), ...u16le(height), 0, 0];
  return riff([...ascii("VP8 "), ...u32le(data.length), ...data]);
}

function webpLossless(width: number, height: number): Uint8Array {
  const bits = ((height - 1) << 14) | (width - 1);
  const data = [0x2f, ...u32le(bits >>> 0), 0, 0];
  return riff([...ascii("VP8L"), ...u32le(data.length), ...data]);
}

function webpExtended(width: number, height: number): Uint8Array {
  const data = [0x10, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)];
  return riff([...ascii("VP8X"), ...u32le(data.length), ...data]);
}

describe("sniffImage", () => {
  it.each([
    ["jpeg (baseline SOF0)", jpeg(0xc0, 3, 2), "jpeg"],
    ["jpeg (progressive SOF2)", jpeg(0xc2, 3, 2), "jpeg"],
    ["png", png(3, 2), "png"],
    ["gif", gif(3, 2), "gif"],
    ["webp (lossy VP8)", webpLossy(3, 2), "webp"],
    ["webp (lossless VP8L)", webpLossless(3, 2), "webp"],
    ["webp (extended VP8X)", webpExtended(3, 2), "webp"],
  ] as const)("reads the type and the size of a %s", (_label, bytes, type) => {
    expect(sniffImage(bytes)).toEqual({ type, width: 3, height: 2 });
  });

  it("finds the size of a jpeg that has EXIF and other segments before the frame header", () => {
    const exif = [0xff, 0xe1, ...u16be(10), ...ascii("Exif"), 0, 0, 1, 2];
    const comment = [0xff, 0xfe, ...u16be(4), 0x68, 0x69];
    expect(sniffImage(jpeg(0xc0, 640, 480, [...exif, ...comment]))).toEqual({
      type: "jpeg",
      width: 640,
      height: 480,
    });
  });

  it.each([
    ["an empty buffer", new Uint8Array()],
    ["a truncated jpeg", jpeg(0xc0, 3, 2).slice(0, 25)],
    ["a truncated png", png(3, 2).slice(0, 20)],
    ["a truncated gif", gif(3, 2).slice(0, 8)],
    ["a truncated webp", webpLossy(3, 2).slice(0, 24)],
    ["a png with a zero width", png(0, 2)],
    ["a gif with a zero height", gif(3, 0)],
  ])("refuses %s", (_label, bytes) => {
    expect(sniffImage(bytes)).toBeNull();
  });

  it("refuses an svg, whatever its extension or declared type", () => {
    const svg = new TextEncoder().encode(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"></svg>',
    );
    expect(sniffImage(svg)).toBeNull();
  });

  it("refuses text and html", () => {
    expect(
      sniffImage(new TextEncoder().encode("<html><script>alert(1)</script></html>")),
    ).toBeNull();
    expect(
      sniffImage(new TextEncoder().encode("just some text, definitely not a picture")),
    ).toBeNull();
  });

  it("refuses a png signature followed by something that is not an IHDR chunk", () => {
    const bytes = png(3, 2);
    bytes.set(ascii("XXXX"), 12);
    expect(sniffImage(bytes)).toBeNull();
  });
});
