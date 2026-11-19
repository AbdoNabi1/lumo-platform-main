import type { OnlineStoreImagePurpose } from "@/lib/api/online-store";

const MB = 1024 * 1024;

/**
 * A mirror of the server's per-purpose policy (spec 1.7, `services/media/src/application/
 * image-purposes.ts`) for a friendly early message only. Pure, and `import type` only, so client
 * components may import it.
 */
export const UPLOAD_RULES: Readonly<
  Record<OnlineStoreImagePurpose, { readonly types: readonly string[]; readonly maxBytes: number }>
> = {
  logo: { types: ["image/png", "image/webp", "image/jpeg"], maxBytes: 2 * MB },
  favicon: { types: ["image/png"], maxBytes: 1 * MB },
  share_image: { types: ["image/jpeg", "image/png"], maxBytes: 5 * MB },
  section_image: { types: ["image/jpeg", "image/png", "image/webp"], maxBytes: 8 * MB },
};

export function checkUpload(
  file: { readonly type: string; readonly size: number },
  purpose: OnlineStoreImagePurpose,
): "ok" | "too_large" | "unsupported" {
  const rule = UPLOAD_RULES[purpose];
  if (!rule.types.includes(file.type)) return "unsupported";
  return file.size > rule.maxBytes ? "too_large" : "ok";
}
