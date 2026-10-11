export type ImageType = "jpeg" | "png" | "webp" | "gif";

export interface SniffedImage {
  readonly type: ImageType;
  readonly width: number;
  readonly height: number;
}

const u16be = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u16le = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, at: number): number => u16le(b, at) | ((b[at + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, at: number): number => u16be(b, at) * 0x10000 + u16be(b, at + 2);
const u32le = (b: Uint8Array, at: number): number => u16le(b, at) + u16le(b, at + 2) * 0x10000;

function hasAscii(b: Uint8Array, at: number, text: string): boolean {
  if (b.length < at + text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (b[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function sized(type: ImageType, width: number, height: number): SniffedImage | null {
  return width > 0 && height > 0 ? { type, width, height } : null;
}

/** Start-of-frame markers carry the size; DHT (C4), JPG (C8) and DAC (CC) share the range but do not. */
function isFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function sniffJpeg(b: Uint8Array): SniffedImage | null {
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / scan before any frame
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2; // standalone markers carry no length
      continue;
    }
    const length = u16be(b, at + 2);
    if (length < 2) return null;
    if (isFrameMarker(marker)) {
      if (at + 9 > b.length) return null;
      return sized("jpeg", u16be(b, at + 7), u16be(b, at + 5));
    }
    at += 2 + length;
  }
  return null;
}

function sniffPng(b: Uint8Array): SniffedImage | null {
  if (b.length < 24 || !hasAscii(b, 12, "IHDR")) return null;
  return sized("png", u32be(b, 16), u32be(b, 20));
}

function sniffGif(b: Uint8Array): SniffedImage | null {
  if (b.length < 10) return null;
  return sized("gif", u16le(b, 6), u16le(b, 8));
}

function sniffWebp(b: Uint8Array): SniffedImage | null {
  if (!hasAscii(b, 8, "WEBP")) return null;
  if (hasAscii(b, 12, "VP8 ")) {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return sized("webp", u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  if (hasAscii(b, 12, "VP8L")) {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    return sized("webp", (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (hasAscii(b, 12, "VP8X")) {
    if (b.length < 30) return null;
    return sized("webp", u24le(b, 24) + 1, u24le(b, 27) + 1);
  }
  return null;
}

/**
 * Reads what the BYTES say an image is — never the file name or the declared content type, which a
 * client controls. Only JPEG, PNG, WebP and GIF are recognised; anything else (SVG included: it is
 * XML that can carry script) is `null`. Pure, with no native dependency: it reads the header only.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return sniffJpeg(bytes);
  }
  if (hasAscii(bytes, 1, "PNG") && bytes[0] === 0x89 && bytes[4] === 0x0d) return sniffPng(bytes);
  if (hasAscii(bytes, 0, "GIF87a") || hasAscii(bytes, 0, "GIF89a")) return sniffGif(bytes);
  if (hasAscii(bytes, 0, "RIFF")) return sniffWebp(bytes);
  return null;
}
