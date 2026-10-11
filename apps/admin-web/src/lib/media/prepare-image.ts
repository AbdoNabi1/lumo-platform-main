/**
 * Plan 2C-3 — runs in the BROWSER before a product image is uploaded. The server never trusts it
 * (it sniffs the bytes and caps the size itself); this only makes uploads small and quick, and drops
 * the EXIF/GPS data a phone photo carries, because re-drawing the picture on a canvas keeps pixels only.
 */

/** The server's cap. A file still over it after preparation is refused here, before it is sent. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** The longest side kept, in pixels. */
export const MAX_SIDE = 2048;
const QUALITY = 0.85;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type PrepareResult =
  | { readonly ok: true; readonly file: File }
  | { readonly ok: false; readonly reason: "too_large" | "unsupported" };

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

const withExtension = (name: string, extension: string): string => {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name || "image"}.${extension}`;
};

/**
 * JPEG, PNG and WebP are decoded, scaled so the longest side is at most {@link MAX_SIDE}, and re-encoded
 * as WebP at 0.85 (JPEG if the browser cannot write WebP). Transparency survives, since WebP keeps alpha.
 * A GIF is passed through as it is, to keep its animation. Anything else (an SVG included) is refused.
 */
export async function prepareImage(file: File): Promise<PrepareResult> {
  if (!ACCEPTED.has(file.type)) return { ok: false, reason: "unsupported" };

  if (file.type === "image/gif") {
    return file.size > MAX_UPLOAD_BYTES ? { ok: false, reason: "too_large" } : { ok: true, file };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: "unsupported" };
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (context === null) {
    bitmap.close();
    return { ok: false, reason: "unsupported" };
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let blob = await encode(canvas, "image/webp");
  let extension = "webp";
  if (blob === null || blob.type !== "image/webp") {
    blob = await encode(canvas, "image/jpeg");
    extension = "jpg";
  }
  if (blob === null) return { ok: false, reason: "unsupported" };
  if (blob.size > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };

  return {
    ok: true,
    file: new File([blob], withExtension(file.name, extension), { type: blob.type }),
  };
}
